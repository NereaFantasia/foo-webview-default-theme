import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { zipEntries } from '../../../scripts/release/zip.mjs';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import {
  publishedKey,
  rootPayload,
  rootSigner,
  signRoot,
  type RootSigner,
} from '../../fixtures/rootSigning.ts';
import { TEMPLATE_DIRECTORY, installTemplateHost } from '../../fixtures/templateHost.ts';
import { ROOT_URL, sha256 } from '../../../src/update/contract.ts';
import { confirmedStartupAtom } from '../../../src/update/loaderConfirmation.ts';
import { json } from '../../../src/update/loaderContract.ts';
import {
  AUTO_UPDATE,
  UPDATE_MODE,
  startUpdater,
  type UpdateMode,
} from '../../../src/update/updater.ts';

const CURRENT = { v: '0.1.0', dir: '0.1.0' };
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
const text = (value: string) => new TextEncoder().encode(value);
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

interface Published {
  readonly candidate: Record<string, unknown>;
  readonly routes: ReadonlyMap<string, Uint8Array>;
}
async function publish(version: string, fields: Record<string, unknown> = {}): Promise<Published> {
  const base = `https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v${version}`;
  const zip = zipEntries([
    { path: 'index.html', bytes: text(`<!doctype html><title>${version}</title>`) },
    { path: 'assets/App.js', bytes: text('console.log(1)') },
  ]);
  const needs = {
    upgradeFrom: '>=0.1.0',
    requires: { foo_ui_webview2: '>=2.0.0' },
    requiresLoader: 1,
    ...fields,
  };
  const release = text(
    JSON.stringify({
      format: 1,
      version,
      ...needs,
      notes: { 'zh-CN': `${version} 的说明` },
      components: {
        frontend: { url: `${base}/fe-${version}.zip`, size: zip.length, sha256: await sha256(zip) },
      },
    }),
  );
  return {
    candidate: {
      version,
      ...needs,
      release: `${base}/release.json`,
      releaseSha256: await sha256(release),
    },
    routes: new Map([
      [`${base}/release.json`, release],
      [`${base}/fe-${version}.zip`, zip],
    ]),
  };
}

async function setup(
  options: {
    readonly files?: Record<string, string>;
    readonly auto?: boolean;
    readonly mode?: UpdateMode;
    readonly storageAvailable?: boolean;
    readonly pause?: () => Promise<void>;
  } = {},
) {
  const env = installTemplateHost({
    'current.json': JSON.stringify({ schema: 1, frontend: { version: CURRENT } }),
    'fe/0.1.0/installed.json': JSON.stringify({
      schema: 1,
      version: '0.1.0',
      files: { 'index.html': 'f'.repeat(64) },
    }),
    ...options.files,
  });
  if (options.auto) env.host.config.set(AUTO_UPDATE.key, true);
  if (options.mode) env.host.config.set(UPDATE_MODE.key, options.mode);
  const signer = await rootSigner('k1');
  const routes = new Map<string, Uint8Array | Error>();
  env.host.answer('http.get', (params) => {
    const body = routes.get(String(params['url']));
    if (body instanceof Error) return hostFailure('OPERATION_FAILED', body.message);
    if (!body) return { success: true, status: 404, headers: {}, body: '', responseType: 'base64' };
    return {
      success: true,
      status: 200,
      headers: {},
      body: toBase64(body),
      responseType: 'base64',
    };
  });
  env.host.answer('misc.restart', { success: true });
  const store = createStore();
  const suffixes = ['abc123', 'def456', 'ghi789'];
  const updater = startUpdater(store, {
    host: env.host.fb,
    writer: createMemoryConfigWriter(env.host.fb),
    storageAvailable: options.storageAvailable,
    keys: [publishedKey(signer)],
    now: () => 1000,
    random: () => 0.5,
    suffix: () => suffixes.shift() ?? 'zzz999',
    pause: options.pause ?? (async () => {}),
  });
  onTestFinished(updater.dispose);
  const mode = options.mode;
  if (mode) await vi.waitFor(() => expect(store.get(updater.mode)).toBe(mode));
  async function root(serial: number, stable: readonly Published[], fields = {}, by?: RootSigner) {
    for (const item of stable) for (const [url, body] of item.routes) routes.set(url, body);
    const payload = rootPayload(serial, {
      channels: { stable: stable.map((item) => item.candidate) },
      ...fields,
    });
    routes.set(ROOT_URL, text(await signRoot(payload, [by ?? signer])));
  }
  return {
    env,
    store,
    updater,
    routes,
    root,
    status: () => store.get(updater.status),
    pointer: () => json(env.text('current.json') ?? null),
    confirm: () => store.set(confirmedStartupAtom, STARTUP),
    fetched: () => env.host.callsTo('http.get').map((params) => String(params['url'])),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('前端更新器', () => {
  it('确认之前不检查，也不联网', async () => {
    const t = await setup();
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'off' });
    expect(t.fetched()).toEqual([]);
  });

  it('可信存储不可用时不检查、不清理，也不能开启自动更新', async () => {
    vi.useFakeTimers();
    const t = await setup({ auto: true, storageAvailable: false });
    t.confirm();
    await t.updater.check();
    await t.updater.reset();
    expect(await t.updater.setMode('auto')).toBe(false);
    await vi.advanceTimersByTimeAsync(7 * 60 * 60_000);
    expect(t.status()).toEqual({ phase: 'off', reason: 'storage' });
    expect(t.fetched()).toEqual([]);
    expect(t.env.host.callsTo('file.write')).toEqual([]);
    expect(t.env.host.callsTo('file.deleteAsync')).toEqual([]);
  });

  it('自动档手动检查装好新版本，写 pending，信任状态先于下载落盘', async () => {
    const t = await setup({ mode: 'auto' });
    await t.root(5, [await publish('0.2.0')]);
    t.confirm();
    expect(t.status()).toMatchObject({ phase: 'idle', checkedAt: null });
    await t.updater.check();
    expect(t.status()).toEqual({
      phase: 'ready',
      version: '0.2.0',
      notes: { 'zh-CN': '0.2.0 的说明' },
      latest: '0.2.0',
      limit: null,
      pluginRange: null,
    });
    expect(t.pointer()).toEqual({
      schema: 1,
      frontend: { version: CURRENT, pending: { v: '0.2.0', dir: '0.2.0_abc123' } },
    });
    expect(t.env.text('fe/0.2.0_abc123/index.html')).toBe('<!doctype html><title>0.2.0</title>');
    const writes = t.env.host
      .callsTo('file.write')
      .map((params) => String(params['path']))
      .filter((path) => !path.includes('\\state\\sessions\\'));
    expect(writes[0]).toBe(`${TEMPLATE_DIRECTORY}\\state\\update-state.json`);
    expect(t.env.host.callsTo('http.get')[0]).toMatchObject({
      url: ROOT_URL,
      responseType: 'arraybuffer',
      headers: { 'Cache-Control': 'no-cache' },
    });
    expect(json(t.env.text('state/update-state.json') ?? null)).toMatchObject({
      trust: { roots: { '1': { serial: 5 } } },
    });
  });

  it('已是最新时停在空闲，记下检查时间', async () => {
    const t = await setup();
    await t.root(1, []);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'idle', checkedAt: 1000, failure: null, gaveUp: false });
  });

  it('网络、签名、序号与格式问题分别报告，不改指针', async () => {
    const t = await setup();
    t.confirm();
    t.routes.set(ROOT_URL, new Error('Send failed: TLS certificate date is invalid'));
    await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'idle', failure: 'clock' });
    t.routes.set(ROOT_URL, text('<html>门户</html>'));
    await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'idle', failure: 'malformed' });
    await t.root(5, [], {}, await rootSigner('stranger'));
    await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'idle', failure: 'unverified' });
    expect(t.env.files.has('state/update-state.json')).toBe(false);
    await t.root(5, []);
    await t.updater.check();
    await t.root(4, []);
    await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'idle', failure: 'stale' });
    await t.root(6, [], { minUpdater: 9 });
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'manual', reason: 'updater' });
    expect(t.pointer()).toEqual({ schema: 1, frontend: { version: CURRENT } });
  });

  it('更新状态损坏时停下，要求手动处理', async () => {
    const t = await setup({ files: { 'state/update-state.json': '{"schema":1,"trust":{}}' } });
    await t.root(1, [await publish('0.2.0')]);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'manual', reason: 'state' });
    expect(t.fetched()).not.toContain(expect.stringContaining('release.json'));
  });

  it('重置写回初始状态后立刻检查，之后照常安装', async () => {
    const t = await setup({
      mode: 'auto',
      files: { 'state/update-state.json': '{"schema":1,"trust":{}}' },
    });
    await t.root(1, [await publish('0.2.0')]);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'manual', reason: 'state' });
    await t.updater.reset();
    expect(t.status()).toMatchObject({ phase: 'ready', version: '0.2.0' });
    expect(json(t.env.text('state/update-state.json') ?? null)).toMatchObject({
      schema: 1,
      trust: { roots: { '1': { serial: 1 } } },
    });
  });

  it.each([
    ['截断 JSON', '{"schema":1'],
    ['空内容', ''],
    ['null', 'null'],
    ['缺少发行哈希', JSON.stringify({ schema: 1, releases: [{ v: '0.2.0' }] })],
    [
      '非法版本',
      JSON.stringify({ schema: 1, releases: [{ v: 'bad', releaseSha256: 'a'.repeat(64) }] }),
    ],
    ['非法哈希', JSON.stringify({ schema: 1, releases: [{ v: '0.2.0', releaseSha256: 'bad' }] })],
  ])('坏版本记录损坏（%s）时保留文件与指针，停止下载', async (_, saved) => {
    const t = await setup({ files: { 'state/failed-releases.json': saved } });
    await t.root(1, [await publish('0.2.0')]);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'manual', reason: 'failed-releases' });
    expect(t.env.text('state/failed-releases.json')).toBe(saved);
    expect(t.pointer()).toEqual({ schema: 1, frontend: { version: CURRENT } });
    expect(t.fetched()).toEqual([ROOT_URL]);
    const state = t.env.text('state/update-state.json');
    await t.updater.reset();
    expect(t.env.text('state/update-state.json')).toBe(state);
    expect(t.fetched()).toEqual([ROOT_URL]);
  });

  it('指针损坏时不通过重置清除已接受的信任状态', async () => {
    const t = await setup({ files: { 'current.json': '{broken' } });
    await t.root(3, []);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'manual', reason: 'pointer' });
    const state = t.env.text('state/update-state.json');
    await t.updater.reset();
    expect(t.env.text('state/update-state.json')).toBe(state);
    expect(t.env.text('current.json')).toBe('{broken');
  });

  it('重置前发现坏版本记录也损坏时保留原更新状态', async () => {
    const original = '{"schema":1,"trust":{}}';
    const t = await setup({
      files: {
        'state/update-state.json': original,
        'state/failed-releases.json': '{broken',
      },
    });
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'manual', reason: 'state' });
    await t.updater.reset();
    expect(t.status()).toEqual({ phase: 'manual', reason: 'failed-releases' });
    expect(t.env.text('state/update-state.json')).toBe(original);
    expect(t.fetched()).toEqual([]);
  });

  it('有效坏版本记录按版本与发行哈希排除候选', async () => {
    const release = await publish('0.2.0');
    const t = await setup({
      files: {
        'state/failed-releases.json': JSON.stringify({
          schema: 1,
          releases: [{ v: '0.2.0', releaseSha256: release.candidate['releaseSha256'] }],
        }),
      },
    });
    await t.root(1, [release]);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'idle', failure: null });
    expect(t.pointer()).toEqual({ schema: 1, frontend: { version: CURRENT } });
    expect(t.fetched()).toEqual([ROOT_URL]);
  });

  it('插件版本挡住新版时说明要求，不下载', async () => {
    const t = await setup();
    await t.root(1, [await publish('0.2.0', { requires: { foo_ui_webview2: '>=2.4.0' } })]);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({
      phase: 'blocked',
      latest: '0.2.0',
      limit: 'plugin',
      pluginRange: '>=2.4.0',
    });
    expect(t.fetched()).toEqual([ROOT_URL]);
  });

  it('撤回已下载的 pending，并跳过撤回的版本', async () => {
    const pending = { v: '0.2.0', dir: '0.2.0_aaaaaa' };
    const t = await setup({
      files: {
        'current.json': JSON.stringify({ schema: 1, frontend: { version: CURRENT, pending } }),
      },
    });
    await t.root(1, [await publish('0.2.0')], { revoked: ['0.2.0'] });
    t.confirm();
    await t.updater.check();
    expect(t.pointer()).toEqual({ schema: 1, frontend: { version: CURRENT } });
    expect(t.status()).toMatchObject({ phase: 'idle', failure: null });
  });

  it('同一份发行已下载成 pending 时不再下载前端包', async () => {
    const release = await publish('0.2.0');
    const pending = { v: '0.2.0', dir: '0.2.0_aaaaaa' };
    const t = await setup({
      files: {
        'current.json': JSON.stringify({ schema: 1, frontend: { version: CURRENT, pending } }),
        'fe/0.2.0_aaaaaa/installed.json': JSON.stringify({
          schema: 1,
          version: '0.2.0',
          files: { 'index.html': 'f'.repeat(64) },
          releaseSha256: release.candidate['releaseSha256'],
        }),
      },
    });
    await t.root(1, [release]);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'ready', version: '0.2.0' });
    expect(t.fetched().some((url) => url.endsWith('.zip'))).toBe(false);
  });

  it('同一原因失败到上限后自动检查放弃这个版本，手动检查仍会重试', async () => {
    vi.useFakeTimers();
    const release = await publish('0.2.0');
    const t = await setup({ auto: true });
    await t.root(1, [release]);
    const zipUrl = [...release.routes.keys()].find((url) => url.endsWith('.zip')) ?? '';
    t.routes.set(zipUrl, text('坏的'));
    t.confirm();
    await vi.waitFor(() => expect(t.store.get(t.updater.mode)).toBe('auto'));
    for (let round = 0; round < 3; round += 1) await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'idle', failure: 'size', gaveUp: false });
    expect(json(t.env.text('state/update-state.json') ?? null)).toMatchObject({
      failures: { '0.2.0': { size: 3 } },
    });
    const downloads = () => t.fetched().filter((url) => url === zipUrl).length;
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(t.status()).toMatchObject({ phase: 'idle', failure: 'size', gaveUp: true }),
    );
    expect(downloads()).toBe(3);
    for (const [url, body] of release.routes) t.routes.set(url, body);
    await t.updater.check();
    expect(t.status()).toMatchObject({ phase: 'ready', version: '0.2.0' });
    expect(json(t.env.text('state/update-state.json') ?? null)).toMatchObject({ failures: {} });
  });

  it('开启自动更新后约 1 分钟查第一次，之后每 6 小时左右再查', async () => {
    vi.useFakeTimers();
    const t = await setup();
    await t.root(1, []);
    t.confirm();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.fetched()).toEqual([]);
    await t.updater.setMode('auto');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(t.fetched()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.fetched()).toEqual([ROOT_URL]);
    // 验签走真实的异步，等这一轮结束、排好下一次再推进时钟。
    await vi.waitFor(() => expect(t.status()).toMatchObject({ phase: 'idle', checkedAt: 1000 }));
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    expect(t.fetched()).toEqual([ROOT_URL, ROOT_URL]);
    await vi.waitFor(() => expect(t.status()).toMatchObject({ phase: 'idle' }));
    expect(t.env.host.config.get(UPDATE_MODE.key)).toBe('auto');
    await t.updater.setMode('off');
    await vi.advanceTimersByTimeAsync(7 * 60 * 60_000);
    expect(t.fetched()).toHaveLength(2);
  });

  it('释放后不再写指针', async () => {
    const t = await setup();
    await t.root(1, [await publish('0.2.0')]);
    t.confirm();
    const checking = t.updater.check();
    t.updater.dispose();
    await checking;
    expect(t.pointer()).toEqual({ schema: 1, frontend: { version: CURRENT } });
  });

  it('手动检查进行中打开自动更新，之后照常排定时检查', async () => {
    vi.useFakeTimers();
    const t = await setup();
    await t.root(1, []);
    t.confirm();
    const manual = t.updater.check();
    await t.updater.setMode('auto');
    await manual;
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(t.fetched()).toEqual([ROOT_URL, ROOT_URL]));
  });

  it('另有 foobar2000 在用这个目录时停下检查与清理', async () => {
    vi.useFakeTimers();
    const t = await setup({ files: { 'fe/0.0.9/installed.json': '{}' } });
    await t.root(1, [await publish('0.2.0')]);
    t.env.tick(5_000);
    t.confirm();
    const own = `state/sessions/${STARTUP.session.sessionId}.json`;
    await vi.waitFor(() => expect(t.env.files.has(own)).toBe(true));
    t.env.tick(60_000);
    t.env.write('state/sessions/33333333-3333-4333-8333-333333333333.json', '{}');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(t.status()).toEqual({ phase: 'shared' });
    await t.updater.check();
    expect(t.status()).toEqual({ phase: 'shared' });
    expect(t.fetched()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(t.env.host.callsTo('file.deleteAsync')).toEqual([]);
  });

  it('安装期间发现共用目录，立即停止后续文件写入和指针提交', async () => {
    vi.useFakeTimers();
    let pause = async () => {};
    const t = await setup({ pause: () => pause() });
    await t.root(1, [await publish('0.2.0')]);
    t.env.tick(5_000);
    t.confirm();
    pause = async () => {
      t.env.tick(60_000);
      t.env.write('state/sessions/33333333-3333-4333-8333-333333333333.json', '{}');
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    };
    await t.updater.install();
    expect(t.status()).toEqual({ phase: 'shared' });
    expect(t.env.files.has('fe/0.2.0_abc123/assets/App.js')).toBe(false);
    expect(t.env.files.has('fe/0.2.0_abc123/installed.json')).toBe(false);
    expect(t.pointer()).toEqual({ schema: 1, frontend: { version: CURRENT } });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.env.host.callsTo('file.deleteAsync')).toEqual([]);
  });

  it('启动约 10 分钟后清理不再引用的版本目录', async () => {
    vi.useFakeTimers();
    const t = await setup({ files: { 'fe/0.0.9/installed.json': '{}' } });
    t.confirm();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(t.env.host.callsTo('file.deleteAsync')).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(t.env.host.callsTo('file.deleteAsync')).toEqual([
        { paths: [`${TEMPLATE_DIRECTORY}\\fe\\0.0.9`], moveToTrash: false },
      ]),
    );
    expect(t.env.files.has('fe/0.1.0/installed.json')).toBe(true);
  });

  it('关闭档手动检查只报可更新，下载并安装才下载', async () => {
    const t = await setup();
    await t.root(1, [await publish('0.2.0')]);
    t.confirm();
    await t.updater.check();
    expect(t.status()).toEqual({
      phase: 'available',
      version: '0.2.0',
      latest: '0.2.0',
      limit: null,
      pluginRange: null,
    });
    expect(t.fetched()).toEqual([ROOT_URL]);
    expect(t.pointer()).toEqual({ schema: 1, frontend: { version: CURRENT } });
    expect(t.store.get(t.updater.catalog)).toMatchObject({ target: '0.2.0', pending: null });
    await t.updater.install();
    expect(t.status()).toMatchObject({ phase: 'ready', version: '0.2.0' });
    expect(t.pointer()).toMatchObject({ frontend: { pending: { v: '0.2.0' } } });
    expect(t.store.get(t.updater.catalog)?.pending).toBe('0.2.0');
    t.routes.delete(ROOT_URL);
    await t.updater.check();
    expect(t.store.get(t.updater.catalog)).toBeNull();
  });

  it('仅通知档照常定时检查，有新版只提示不下载', async () => {
    vi.useFakeTimers();
    const t = await setup({ mode: 'notify' });
    await t.root(1, [await publish('0.2.0')]);
    t.confirm();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(t.status()).toMatchObject({ phase: 'available', version: '0.2.0' }),
    );
    expect(t.fetched()).toEqual([ROOT_URL]);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    await vi.waitFor(() => expect(t.fetched()).toEqual([ROOT_URL, ROOT_URL]));
  });

  it('模式键没有值时按旧开关推算，改模式只写新键', async () => {
    const t = await setup({ auto: true });
    await vi.waitFor(() => expect(t.store.get(t.updater.mode)).toBe('auto'));
    expect(await t.updater.setMode('notify')).toBe(true);
    expect(t.store.get(t.updater.mode)).toBe('notify');
    expect(t.env.host.config.get(UPDATE_MODE.key)).toBe('notify');
    expect(t.env.host.config.get(AUTO_UPDATE.key)).toBe(true);
  });

  it('先显示自带的更新日志，拉到根清单指向的那份后替换，取不到时保留', async () => {
    const first = {
      version: '0.1.0',
      notes: { 'zh-CN': { title: '首发', fixes: ['第一个公开版本'] } },
    };
    const remote = text(
      JSON.stringify({
        format: 1,
        entries: [first, { version: '0.2.0', notes: { en: { title: 'Fixes', fixes: ['Fixed'] } } }],
      }),
    );
    const url =
      'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/changelog.json';
    const file = { url, size: remote.length, sha256: await sha256(remote) };
    const t = await setup({
      files: { 'fe/0.1.0/changelog.json': JSON.stringify({ format: 1, entries: [first] }) },
    });
    const changelog = () => t.store.get(t.updater.changelog);
    t.confirm();
    await vi.waitFor(() => expect(changelog()?.source).toBe('bundled'));
    await t.root(1, [], { changelog: file });
    await t.updater.check();
    await vi.waitFor(() => expect(t.fetched()).toContain(url));
    await vi.waitFor(() => expect(t.store.get(t.updater.changelogFailed)).toBe(true));
    expect(changelog()?.entries.map((entry) => entry.version)).toEqual(['0.1.0']);
    t.routes.set(url, remote);
    await t.root(2, [], { changelog: file });
    await t.updater.check();
    await vi.waitFor(() => expect(changelog()?.source).toBe('remote'));
    expect(changelog()?.entries.map((entry) => entry.version)).toEqual(['0.2.0', '0.1.0']);
    expect(t.status()).toMatchObject({ phase: 'idle', failure: null });
    expect(t.store.get(t.updater.changelogFailed)).toBe(false);
    await t.root(3, [], { changelog: { ...file, sha256: 'b'.repeat(64) } });
    await t.updater.check();
    await vi.waitFor(() => expect(t.store.get(t.updater.changelogFailed)).toBe(true));
    await t.root(4, [], { changelog: file });
    await t.updater.check();
    await vi.waitFor(() => expect(t.store.get(t.updater.changelogFailed)).toBe(false));
    expect(changelog()?.source).toBe('remote');
  });

  it('立即重启交给宿主', async () => {
    const t = await setup();
    expect(await t.updater.restart()).toBe(true);
    expect(t.env.host.callsTo('misc.restart')).toHaveLength(1);
  });
});
