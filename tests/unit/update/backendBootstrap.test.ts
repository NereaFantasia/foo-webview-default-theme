import { randomUUID } from 'node:crypto';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startBackendBootstrap } from '../../../src/update/backendBootstrap.ts';
import type { PlatformHints } from '../../../src/update/nodeRuntime.ts';
import {
  confirmedStartupAtom,
  type ConfirmedStartup,
} from '../../../src/update/loaderConfirmation.ts';
import { sha256 } from '../../../src/update/contract.ts';
import { runtimeArtifacts } from '../../../scripts/release/runtime-artifacts.mjs';
import { zipEntries } from '../../../scripts/release/zip.mjs';
import { toBase64 } from '../../../src/update/templateFiles.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';
import type { BackendLaunch } from '../../../src/server/backendConnection.ts';

async function setup(enabled = true, platform: PlatformHints | null = null) {
  const env = installTemplateHost();
  const store = createStore();
  const startup: ConfirmedStartup = {
    directory: TEMPLATE_DIRECTORY,
    installId: randomUUID(),
    plugin: '2.0.0',
    session: {
      schema: 1,
      sessionId: randomUUID(),
      version: { v: '0.1.5', dir: '0.1.5' },
      loader: 1,
      skipped: [],
    },
  };
  const node = new Uint8Array([1, 2, 3]);
  const runtime = runtimeArtifacts({
    version: '24.16.0',
    arch: 'x64',
    node,
    license: new Uint8Array([4]),
    source: { url: 'https://example.com/node.exe', size: node.length, sha256: await sha256(node) },
  });
  const bundle = zipEntries([{ path: 'server.cjs', bytes: new Uint8Array([5]) }]);
  const routes = new Map(
    runtime.assets.map((asset) => [
      `https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/${runtime.tag}/${asset.name}`,
      asset.bytes,
    ]),
  );
  const rt = runtime.assets.find((asset) => asset.name === 'runtime.json');
  if (!rt) throw new Error('缺少清单');
  const backend = new TextEncoder().encode(
    JSON.stringify({
      format: 1,
      version: '0.1.5',
      protocol: 1,
      backend: {
        url: 'https://example.com/be.zip',
        size: bundle.length,
        sha256: await sha256(bundle),
      },
      runtime: {
        url: [...routes.keys()].find((url) => url.endsWith('/runtime.json')),
        size: rt.bytes.length,
        sha256: await sha256(new Uint8Array(rt.bytes)),
      },
    }),
  );
  routes.set('https://example.com/be.zip', bundle);
  env.files.set('fe/0.1.5/backend.json', backend);
  env.write(
    'fe/0.1.5/installed.json',
    JSON.stringify({ files: enabled ? { 'backend.json': await sha256(backend) } : {} }),
  );
  env.host.answer('http.get', (params) => {
    const bytes = routes.get(String(params['url']));
    return {
      success: true,
      status: bytes ? 200 : 404,
      headers: {},
      responseType: 'base64',
      body: bytes ? toBase64(bytes) : '',
    };
  });
  env.host.answer('shell.spawn', (params) => {
    const args = params['args'];
    if (!Array.isArray(args) || typeof args[2] !== 'string') throw new Error('缺少自检路径');
    env.write(
      args[2].slice(TEMPLATE_DIRECTORY.length + 1).replaceAll('\\', '/'),
      JSON.stringify({
        version: runtime.manifest.version,
        arch: 'x64',
        platform: 'win32',
        sha256: runtime.manifest.sha256,
        environment: false,
      }),
    );
    return { success: true, processId: 123 };
  });
  const failed = atom(false);
  const connect = vi.fn(async (target: BackendLaunch) => ({
    ...target,
    protocol: 1 as const,
    launchId: randomUUID(),
    pid: 123,
    runtime: target.runtimeVersion,
    arch: target.runtimeArch,
  }));
  const service = startBackendBootstrap(
    store,
    { connect, failed },
    {
      host: {
        ...env.host.fb,
        file: {
          ...env.host.fb.file,
          write: (path, content, options) =>
            env.host.fb.file.write(
              path,
              options?.encoding === 'binary' ? content : content.replaceAll('\n', '\r\n'),
              options,
            ),
        },
      },
      suffix: () => 'abc123',
      pause: async () => {},
      readLocal: async (relative) => new Uint8Array(env.files.get(relative) ?? []),
      platform: async () => platform,
    },
  );
  onTestFinished(() => service.dispose());
  return { ...env, store, startup, service, connect, failed, routes };
}

describe('当前版本后端补装', () => {
  it('没有补装描述时保持关闭且不联网', async () => {
    const env = await setup(false);
    env.store.set(confirmedStartupAtom, env.startup);
    await env.service.retry();
    expect(env.store.get(env.service.status)).toEqual({ phase: 'off' });
    expect(env.host.callsTo('http.get')).toHaveLength(0);
    expect(env.connect).not.toHaveBeenCalled();
  });

  it('系统确定跑不了运行时时不下载分块，也不连接', async () => {
    const env = await setup(true, {
      architecture: 'x86',
      bitness: '32',
      platformVersion: '10.0.0',
    });
    env.store.set(confirmedStartupAtom, env.startup);
    await env.service.retry();
    expect(env.store.get(env.service.status)).toEqual({ phase: 'unsupported' });
    expect(env.host.callsTo('http.get').some((call) => /part\d+$/.test(String(call['url'])))).toBe(
      false,
    );
    expect(env.connect).not.toHaveBeenCalled();
  });

  it('先安装并自检，再连接同版本后端；已完整安装可离线重试', async () => {
    const env = await setup();
    env.store.set(confirmedStartupAtom, env.startup);
    await env.service.retry();
    expect(env.store.get(env.service.status)).toEqual({
      phase: 'ready',
      version: '0.1.5',
      runtime: '24.16.0',
    });
    env.store.set(env.failed, true);
    expect(env.store.get(env.service.status)).toMatchObject({ phase: 'failed', reason: 'stopped' });
    env.routes.clear();
    await env.service.retry();
    expect(env.store.get(env.service.status).phase).toBe('ready');
  });

  it('准备期间换版本，旧任务不盖掉新任务，也不连接旧后端', async () => {
    const env = await setup();
    const held = env.host.hold('http.get');
    env.store.set(confirmedStartupAtom, env.startup);
    await vi.waitFor(() => expect(held.pending.length).toBe(1));
    env.write('fe/0.1.6/installed.json', JSON.stringify({ files: {} }));
    env.store.set(confirmedStartupAtom, {
      ...env.startup,
      session: { ...env.startup.session, version: { v: '0.1.6', dir: '0.1.6' } },
    });
    held.release();
    await vi.waitFor(() => expect(env.store.get(env.service.status).phase).toBe('off'));
    expect(env.connect).not.toHaveBeenCalled();
  });

  it('下载途中释放后不再安装或连接', async () => {
    const env = await setup();
    const held = env.host.hold('http.get');
    env.store.set(confirmedStartupAtom, env.startup);
    const pending = env.service.retry();
    await vi.waitFor(() => expect(held.pending.length).toBe(1));
    env.service.dispose();
    held.release();
    await pending;
    expect([...env.files.keys()].some((path) => path.startsWith('rt/'))).toBe(false);
    expect(env.connect).not.toHaveBeenCalled();
  });
});
