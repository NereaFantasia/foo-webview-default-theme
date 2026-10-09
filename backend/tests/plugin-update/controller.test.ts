import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPluginController } from '../../plugin-update/controller.ts';
import { digest } from '../../plugin-update/files.ts';
import type { PluginPlan } from '../../plugin-update/plan.ts';
import { preparePluginUpdate } from '../../plugin-update/prepare.ts';
import { INITIAL_TRUST, acceptRoot } from '../../../src/update/rootTrust.ts';
import { verifyPluginRelease } from '../../../src/update/pluginRelease.ts';
import {
  PLUGIN_TRANSACTION,
  type PluginTransactionStatus,
} from '../../../src/server/pluginProtocol.ts';
import { publicSpki, signEnvelope } from '../../../scripts/release/signing.mjs';

const keys = vi.hoisted<{ keyId: string; spki: string }[]>(() => []);
vi.mock('../../../src/update/contract.ts', async (original) => ({
  ...(await original<typeof import('../../../src/update/contract.ts')>()),
  BUILT_IN_KEYS: keys,
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));
vi.mock('../../plugin-update/prepare.ts', async (original) => ({
  ...(await original<typeof import('../../plugin-update/prepare.ts')>()),
  preparePluginUpdate: vi.fn(),
}));

const directories: string[] = [];
const controllers: ReturnType<typeof startPluginController>[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    const path = await realpath(directory);
    if (
      !path.startsWith((await realpath(tmpdir())) + sep) ||
      !basename(path).startsWith('wvu-controller-')
    )
      throw new Error('临时目录超出清理范围');
    await rm(path, { recursive: true, force: true });
  }
  keys.length = 0;
});

async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'wvu-controller-')));
  directories.push(base);
  const profile = join(base, 'profile');
  const template = join(profile, 'webview-ui', 'default');
  const component = join(base, 'components', 'plugin');
  const id = randomUUID();
  const directory = join(dirname(component), '.wvupd', id);
  for (const path of [join(template, 'state'), component, directory])
    await mkdir(path, { recursive: true });
  const executable = join(base, 'foobar2000.exe');
  await writeFile(executable, 'host');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const signer = { keyId: 'plugin', privateKeyPem };
  keys.push({ keyId: signer.keyId, spki: publicSpki(privateKeyPem) });
  const signedRelease = await signEnvelope(
    JSON.stringify({
      format: 1,
      component: 'foo_ui_webview2',
      version: '2.1.0',
      arch: 'x64',
      updater: 1,
      profileCompatible: true,
      hosts: ['2.25.8.0'],
      previous: ['2.0.0'],
      themes: ['0.2.0'],
      files: ['foo_ui_webview2.dll', 'WebView2Loader.dll'].map((path) => ({
        path,
        size: 128,
        sha256: 'a'.repeat(64),
      })),
    }),
    [signer],
  );
  const root = await signEnvelope(
    JSON.stringify({
      format: 1,
      serial: 1,
      minUpdater: 1,
      channels: { stable: [] },
      plugins: [
        {
          version: '2.1.0',
          arch: 'x64',
          url: 'https://example.com/plugin.json',
          size: Buffer.byteLength(signedRelease),
          sha256: digest(signedRelease),
        },
      ],
    }),
    [signer],
  );
  const decision = await acceptRoot(INITIAL_TRUST, root, keys);
  if (decision.kind !== 'accepted') throw new Error('根清单未通过');
  await writeFile(
    join(template, 'state/update-state.json'),
    JSON.stringify({ schema: 1, trust: decision.state, failures: {} }),
  );
  const options = {
    directory: template,
    version: '0.2.0',
    installId: randomUUID(),
    sessionId: randomUUID(),
  };
  const plan: PluginPlan = {
    schema: 1,
    id,
    nonce: 'b'.repeat(64),
    componentDirectory: component,
    profileDirectory: profile,
    templateDirectory: template,
    executable,
    executableHash: digest('host'),
    hostVersion: '2.25.8.0',
    volume: (await stat(component)).dev.toString(),
    installId: options.installId,
    theme: { v: '0.2.0', dir: '0.2.0' },
    themeRelease: 'c'.repeat(64),
    previousVersion: '2.0.0',
    hostPid: process.ppid,
    releaseHash: digest(signedRelease),
    previous: { 'foo_ui_webview2.dll': 'd'.repeat(64), 'WebView2Loader.dll': null },
    recovery: { 'node.exe': digest('node'), 'updater.cjs': digest('updater') },
  };
  const text = JSON.stringify(plan);
  await writeFile(join(directory, 'plan.json'), text);
  await writeFile(join(directory, 'release.json'), signedRelease);
  await writeFile(join(directory, 'node.exe'), 'node');
  await writeFile(join(directory, 'updater.cjs'), 'updater');
  const journal = { schema: 1, id, nonce: plan.nonce, phase: 'prepared', sequence: 0 };
  await writeFile(join(directory, 'journal.json'), JSON.stringify(journal));
  vi.mocked(preparePluginUpdate).mockResolvedValue({
    directory,
    plan,
    sha256: digest(text),
    release: await verifyPluginRelease(signedRelease),
  });
  const child = new ChildProcess();
  Object.defineProperty(child, 'pid', { value: 4242 });
  vi.mocked(spawn).mockImplementation((_command, args) => {
    const attempt = Array.isArray(args) ? args[4] : undefined;
    void Promise.all([
      writeFile(
        join(directory, 'ready.json'),
        JSON.stringify({ id, nonce: plan.nonce, sha256: digest(text), attempt }),
      ),
      writeFile(
        join(directory, 'journal.json'),
        JSON.stringify({ ...journal, phase: 'waitingExit' }),
      ),
    ]).then(() => child.emit('spawn'));
    return child;
  });
  const controller = startPluginController(options);
  controllers.push(controller);
  const input = {
    root,
    request: {
      componentDirectory: component,
      profileDirectory: profile,
      executable,
      theme: plan.theme,
      themeRelease: plan.themeRelease,
      previousVersion: '2.0.0',
      signedRelease,
      payloadDirectory: directory,
    },
  };
  const prepared = (await controller.request('prepare', input)) as PluginTransactionStatus;
  return { controller, options, input, prepared, child, directory, plan, text, signer, template };
}

describe('插件执行器交接', () => {
  it('清空 Node 环境后独立启动，ready 不会自动生成退出授权', async () => {
    const env = await setup();
    vi.stubEnv('NODE_OPTIONS', '--require injected.cjs');
    vi.stubEnv('NODE_PATH', 'E:\\untrusted');
    const ready = await env.controller.request('start', env.prepared);
    expect(ready).toMatchObject({ phase: 'waitingExit', running: true, id: env.plan.id });
    const call = vi.mocked(spawn).mock.calls.at(-1);
    expect(call?.[0]).toBe(join(env.directory, 'node.exe'));
    expect(call?.[1]).toEqual([
      join(env.directory, 'updater.cjs'),
      'execute',
      env.directory,
      digest(env.text),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(call?.[2]).toMatchObject({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: env.directory,
    });
    expect(call?.[2]?.env).not.toHaveProperty('NODE_OPTIONS');
    expect(call?.[2]?.env).not.toHaveProperty('NODE_PATH');
    await expect(readFile(join(env.directory, 'exit.json'))).rejects.toThrow();
    await env.controller.request('authorize', ready);
    expect(JSON.parse(await readFile(join(env.directory, 'exit.json'), 'utf8'))).toMatchObject({
      id: env.plan.id,
      nonce: env.plan.nonce,
      hostPid: process.ppid,
    });
  });

  it('重新连接没有进程对象时不能借用磁盘 ready 退出宿主', async () => {
    const env = await setup();
    const ready = await env.controller.request('start', env.prepared);
    const replacement = startPluginController(env.options);
    controllers.push(replacement);
    await expect(replacement.request('authorize', ready)).rejects.toThrow('不是本次启动');
    await expect(readFile(join(env.directory, 'exit.json'))).rejects.toThrow();
  });

  it.each(['退出', '取消', 'attempt 不符'])('执行器%s时拒绝授权', async (reason) => {
    const env = await setup();
    const ready = (await env.controller.request('start', env.prepared)) as PluginTransactionStatus;
    if (reason === '退出') Object.defineProperty(env.child, 'exitCode', { value: 1 });
    if (reason === '取消') await env.controller.request('cancel', ready);
    const authorization = reason === 'attempt 不符' ? { ...ready, attempt: '0'.repeat(64) } : ready;
    await expect(env.controller.request('authorize', authorization)).rejects.toThrow();
    await expect(readFile(join(env.directory, 'exit.json'))).rejects.toThrow();
  });

  it('旧 ready 导致等待超时，取消标记持久化且不写退出许可', async () => {
    const env = await setup();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => env.child.emit('spawn'));
      return env.child;
    });
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(16000);
    await expect(env.controller.request('start', env.prepared)).rejects.toThrow('超时');
    expect(JSON.parse(await readFile(join(env.directory, 'cancel.json'), 'utf8'))).toEqual({
      id: env.plan.id,
      nonce: env.plan.nonce,
    });
    await expect(readFile(join(env.directory, 'exit.json'))).rejects.toThrow();
  });

  it('维护连接关闭只取消未授权的执行器，授权后的执行器继续独立运行', async () => {
    const env = await setup();
    const ready = await env.controller.request('start', env.prepared);
    await env.controller.request('authorize', ready);
    await env.controller.dispose();
    await expect(readFile(join(env.directory, 'cancel.json'))).rejects.toThrow();
    await expect(env.controller.request('status', {})).rejects.toThrow('连接已关闭');
  });

  it('篡改定位或跨安装计划不能用于恢复入口', async () => {
    const env = await setup();
    await writeFile(
      join(env.template, PLUGIN_TRANSACTION),
      JSON.stringify({ ...env.prepared, directory: dirname(env.directory) }),
    );
    await expect(env.controller.request('status', {})).rejects.toThrow('定位记录');
  });
});
