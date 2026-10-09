import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { BackendStatus } from '../../../src/update/backendBootstrap.ts';
import { ROOT_URL, sha256 } from '../../../src/update/contract.ts';
import { confirmedStartupAtom } from '../../../src/update/loaderConfirmation.ts';
import { startPluginUpdater } from '../../../src/update/pluginUpdater.ts';
import { startUpdater } from '../../../src/update/updater.ts';
import type { PluginTransactionStatus } from '../../../src/server/pluginProtocol.ts';
import { toBase64 } from '../../../src/update/templateFiles.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { rootPayload, rootSigner, signRoot } from '../../fixtures/rootSigning.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';

const CURRENT = { v: '0.2.0', dir: '0.2.0' };
const STARTUP = {
  directory: TEMPLATE_DIRECTORY,
  installId: '11111111-1111-4111-8111-111111111111',
  session: {
    schema: 1,
    sessionId: '22222222-2222-4222-8222-222222222222',
    version: CURRENT,
    loader: 1,
    skipped: [],
  },
  plugin: '2.0.0',
} as const;
const encoder = new TextEncoder();

async function setup() {
  const env = installTemplateHost({
    'current.json': JSON.stringify({ schema: 1, frontend: { version: CURRENT } }),
    'fe/0.2.0/installed.json': JSON.stringify({
      schema: 1,
      version: '0.2.0',
      files: { 'index.html': 'f'.repeat(64) },
      releaseSha256: 'd'.repeat(64),
    }),
  });
  env.host.config.set('defaultTheme.update.mode', 'auto');
  const signer = await rootSigner('plugin');
  const files = ['foo_ui_webview2.dll', 'WebView2Loader.dll'].map((path, index) => ({
    path,
    bytes: new Uint8Array(128).fill(index + 1),
  }));
  const routes = new Map<string, Uint8Array>();
  const publication = async (version = '2.1.0', themes = ['0.2.0']) => {
    const url = `https://example.com/plugin-${version}/plugin.json`;
    const text = await signRoot(
      JSON.stringify({
        format: 1,
        component: 'foo_ui_webview2',
        version,
        arch: 'x64',
        updater: 1,
        profileCompatible: true,
        hosts: ['2.25.8.0'],
        previous: ['2.0.0'],
        themes,
        files: await Promise.all(
          files.map(async (file) => ({
            path: file.path,
            size: file.bytes.length,
            sha256: await sha256(file.bytes),
          })),
        ),
      }),
      [signer],
    );
    const bytes = encoder.encode(text);
    routes.set(url, bytes);
    for (const file of files) routes.set(new URL(file.path, url).href, file.bytes);
    return { version, arch: 'x64', url, size: bytes.length, sha256: await sha256(bytes) };
  };
  const candidate = await publication();
  async function root(serial: number, plugins = [candidate]) {
    routes.set(
      ROOT_URL,
      encoder.encode(await signRoot(rootPayload(serial, { plugins }), [signer])),
    );
  }
  await root(1);
  env.host.answer('http.get', (params) => {
    const bytes = routes.get(String(params['url']));
    return {
      success: true,
      status: bytes ? 200 : 404,
      headers: {},
      body: bytes ? toBase64(bytes) : '',
      responseType: 'base64',
    };
  });
  env.host.answer('config.getVersionInfo', {
    success: true,
    version: 'foobar2000 v2.25.8',
    foobar2000: 'foobar2000 v2.25.8',
    versionFull: 'foobar2000 v2.25.8 x64',
    is64bit: true,
    isPortable: true,
    profilePath: 'E:\\player\\profile',
    plugin: { name: 'foo_ui_webview2', version: '2.0.0' },
  });
  env.host.answer('misc.getComponentPath', {
    success: true,
    path: 'E:\\player\\components\\foo_ui_webview2',
    value: 'E:\\player\\components\\foo_ui_webview2',
  });
  env.host.answer('misc.getProfilePath', {
    success: true,
    path: 'E:\\player\\profile',
    value: 'E:\\player\\profile',
  });
  env.host.answer('misc.getFoobarPath', {
    success: true,
    path: 'E:\\player',
    value: 'E:\\player',
  });
  const order: string[] = [];
  env.host.answer('misc.exit', () => {
    order.push('exit');
    return { success: true };
  });
  const prepared: PluginTransactionStatus = {
    id: '33333333-3333-4333-8333-333333333333',
    nonce: 'a'.repeat(64),
    sha256: 'b'.repeat(64),
    directory: 'E:\\player\\components\\.wvupd\\33333333-3333-4333-8333-333333333333',
    version: '2.1.0',
    releaseSha256: candidate.sha256,
    phase: 'prepared',
    error: null,
    running: false,
    attempt: null,
  };
  let transaction: PluginTransactionStatus | null = null;
  const request = vi.fn<(path: string, body?: unknown) => Promise<unknown>>(async (path) => {
    if (path === '/plugin/status') return transaction;
    order.push(path.slice('/plugin/'.length));
    if (path === '/plugin/prepare') return prepared;
    if (path === '/plugin/start')
      return { ...prepared, phase: 'waitingExit', running: true, attempt: 'c'.repeat(64) };
    return { success: true };
  });
  const store = createStore();
  const updater = startUpdater(store, {
    host: env.host.fb,
    keys: [signer],
    writer: createMemoryConfigWriter(env.host.fb),
    pause: async () => {},
  });
  const backend = {
    status: atom<BackendStatus>({ phase: 'ready', version: '0.2.0', runtime: '24.16.0' }),
  };
  const service = startPluginUpdater(
    store,
    updater,
    backend,
    { request },
    { host: env.host.fb, keys: [signer], pause: async () => {} },
  );
  onTestFinished(() => {
    service.dispose();
    updater.dispose();
  });
  store.set(confirmedStartupAtom, STARTUP);
  await service.check();
  await vi.waitFor(() => expect(store.get(service.status).phase).toBe('available'));
  return {
    ...env,
    store,
    updater,
    backend,
    service,
    request,
    order,
    candidate,
    routes,
    root,
    publication,
    dlls: files,
    prepared,
    status: () => store.get(service.status),
    setTransaction: (value: PluginTransactionStatus) => {
      transaction = value;
    },
  };
}

describe('插件更新发起方', () => {
  it('主题没有新版时仍发现插件，自动模式也不下载 DLL 或退出', async () => {
    const env = await setup();
    expect(env.status()).toEqual({
      phase: 'available',
      version: '2.1.0',
      sha256: env.candidate.sha256,
    });
    expect(env.order).toEqual([]);
    expect(env.host.callsTo('http.get').some((call) => String(call['url']).endsWith('.dll'))).toBe(
      false,
    );
    expect([...env.files.keys()].some((path) => path.endsWith('.dll'))).toBe(false);
  });

  it('根清单撤下全部插件候选后不再显示插件行', async () => {
    const env = await setup();
    await env.root(2, []);
    await env.service.check();
    await vi.waitFor(() => expect(env.status()).toEqual({ phase: 'off' }));
  });

  it('本地服务未就绪时只在有插件候选时提示', async () => {
    const env = await setup();
    env.store.set(env.backend.status, { phase: 'failed', reason: 'prepare', detail: '离线' });
    await vi.waitFor(() => expect(env.status()).toEqual({ phase: 'blocked', reason: 'backend' }));
    await env.root(2, []);
    await env.service.check();
    await vi.waitFor(() => expect(env.status()).toEqual({ phase: 'off' }));
  });

  it('最高版本不兼容时继续选择可达的插件版本', async () => {
    const env = await setup();
    await env.root(2, [await env.publication('2.2.0', ['0.3.0']), env.candidate]);
    await env.service.check();
    await vi.waitFor(() =>
      expect(env.status()).toMatchObject({ phase: 'available', version: '2.1.0' }),
    );
  });

  it('显式安装才下载两份 DLL，准备、就绪、授权之后才退出宿主', async () => {
    const env = await setup();
    await env.service.install(env.candidate.sha256);
    expect(env.status()).toEqual({ phase: 'restarting', version: '2.1.0' });
    expect(env.order).toEqual(['prepare', 'start', 'authorize', 'exit']);
    const paths = [...env.files.keys()].filter((path) => path.endsWith('.dll'));
    expect(paths).toHaveLength(2);
    for (const file of env.files.values()) expect(file).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(env.text('current.json') ?? '{}').frontend).toEqual({ version: CURRENT });
    const request = env.request.mock.calls.find(([path]) => path === '/plugin/prepare')?.[1];
    expect(request).toMatchObject({
      request: {
        executable: 'E:\\player\\foobar2000.exe',
        previousVersion: '2.0.0',
        theme: CURRENT,
        themeRelease: 'd'.repeat(64),
      },
    });
  });

  it('下载哈希不符时不准备、不退出，也不记为已安装', async () => {
    const env = await setup();
    env.routes.set(new URL('foo_ui_webview2.dll', env.candidate.url).href, new Uint8Array(128));
    await env.service.install(env.candidate.sha256);
    expect(env.status()).toMatchObject({
      phase: 'failed',
      detail: expect.stringContaining('hash'),
    });
    expect(env.order).toEqual([]);
    expect([...env.files.keys()].some((path) => path.endsWith('.dll'))).toBe(false);
  });

  it('安装前重新检查根清单，撤回的候选不会继续下载', async () => {
    const env = await setup();
    await env.root(2, []);
    await env.service.install(env.candidate.sha256);
    expect(env.status()).toMatchObject({
      phase: 'failed',
      detail: expect.stringContaining('候选已变化'),
    });
    expect(env.order).toEqual([]);
  });

  it('确认框打开后候选变化时明确报错，不安装旧候选', async () => {
    const env = await setup();
    await env.root(2, [await env.publication('2.2.0')]);
    await env.service.check();
    await vi.waitFor(() =>
      expect(env.status()).toMatchObject({ phase: 'available', version: '2.2.0' }),
    );
    await env.service.install(env.candidate.sha256);
    expect(env.status()).toMatchObject({
      phase: 'failed',
      detail: expect.stringContaining('候选已变化'),
    });
    expect(env.order).toEqual([]);
    expect([...env.files.keys()].some((path) => path.endsWith('.dll'))).toBe(false);
  });

  it('主题已有 pending 时不覆盖它、不安装插件', async () => {
    const env = await setup();
    const frontend = { version: CURRENT, pending: { v: '0.3.0', dir: '0.3.0' } };
    env.write('current.json', JSON.stringify({ schema: 1, frontend }));
    await env.service.install(env.candidate.sha256);
    expect(env.status().phase).toBe('failed');
    expect(env.order).toEqual([]);
    expect(JSON.parse(env.text('current.json') ?? '{}').frontend).toEqual(frontend);
  });

  it('旧 ready 不能用于本次退出，失败后提交取消请求', async () => {
    const env = await setup();
    const request = env.request.getMockImplementation()!;
    env.request.mockImplementation((path, body) =>
      path === '/plugin/start'
        ? Promise.resolve({
            ...env.prepared,
            id: STARTUP.installId,
            phase: 'waitingExit',
            running: true,
            attempt: 'c'.repeat(64),
          })
        : request(path, body),
    );
    await env.service.install(env.candidate.sha256);
    expect(env.status().phase).toBe('failed');
    expect(env.order).toEqual(['prepare', 'cancel']);
    expect(env.host.callsTo('misc.exit')).toEqual([]);
  });

  it('准备期间释放后取消事务，不再启动或退出宿主', async () => {
    const env = await setup();
    const request = env.request.getMockImplementation()!;
    env.request.mockImplementation(async (path, body) => {
      const value = await request(path, body);
      if (path === '/plugin/prepare') env.service.dispose();
      return value;
    });
    await env.service.install(env.candidate.sha256);
    expect(env.order).toEqual(['prepare', 'cancel']);
    expect(env.host.callsTo('misc.exit')).toEqual([]);
  });

  it('插件准备期间暂停主题重启，主题检查排在安装交接之后', async () => {
    const env = await setup();
    const request = env.request.getMockImplementation()!;
    let release = () => {};
    const preparation = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.request.mockImplementation(async (path, body) => {
      if (path === '/plugin/prepare') await preparation;
      return request(path, body);
    });
    const installing = env.service.install(env.candidate.sha256);
    await vi.waitFor(() => expect(env.store.get(env.updater.status).phase).toBe('maintenance'));
    expect(await env.updater.restart()).toBe(false);
    expect(env.host.callsTo('misc.restart')).toEqual([]);
    let checked = false;
    const checking = env.updater.check().then(() => {
      checked = true;
    });
    await Promise.resolve();
    expect(checked).toBe(false);
    release();
    await installing;
    await checking;
    expect(checked).toBe(true);
    expect(env.order).toEqual(['prepare', 'start', 'authorize', 'exit']);
  });

  it('授权请求失败时不退出宿主', async () => {
    const env = await setup();
    const request = env.request.getMockImplementation()!;
    env.request.mockImplementation((path, body) =>
      path === '/plugin/authorize'
        ? Promise.reject(new Error('执行器已结束'))
        : request(path, body),
    );
    await env.service.install(env.candidate.sha256);
    expect(env.status()).toMatchObject({ phase: 'failed', detail: '执行器已结束' });
    expect(env.order).toEqual(['prepare', 'start', 'cancel']);
    expect(env.host.callsTo('misc.exit')).toEqual([]);
  });

  it('已回滚发行按哈希记录，后续检查不再推荐，恢复入口只定位文件', async () => {
    const env = await setup();
    env.setTransaction({ ...env.prepared, phase: 'rolledBack', error: '启动确认超时' });
    await env.service.check();
    await vi.waitFor(() =>
      expect(env.status()).toMatchObject({
        phase: 'transaction',
        transaction: { phase: 'rolledBack' },
      }),
    );
    expect(JSON.parse(env.text('state/failed-plugin-releases.json') ?? '{}').releases).toEqual([
      env.candidate.sha256,
    ]);
    await env.service.openRecovery();
    expect(env.host.callsTo('shell.showInExplorer')[0]).toMatchObject({
      path: `${env.prepared.directory}\\recover.cmd`,
    });
    expect(env.host.callsTo('misc.exit')).toEqual([]);
  });
});
