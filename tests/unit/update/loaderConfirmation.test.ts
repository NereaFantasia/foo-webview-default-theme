import { createStore } from 'jotai/vanilla';
import { webview } from 'foo-webview-sdk/bridge';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  clearPanelStartup,
  confirmedStartupAtom,
  loaderConfirmationAtom,
  startLoaderConfirmation,
} from '../../../src/update/loaderConfirmation.ts';
import {
  cookieName,
  readAttempts,
  readSession,
  json,
  type LoaderSession,
  type VersionRef,
} from '../../../src/update/loaderContract.ts';
import type { LoaderStorage } from '../../../src/kit/loaderStorage.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

const CURRENT = { v: '0.1.0', dir: '0.1.0' };
const OLD = { v: '0.0.9', dir: '0.0.9' };
const BAD = { v: '0.2.0', dir: '0.2.0_abcdef' };
const ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'E:\\themes\\default';
const URL = new globalThis.URL('https://foo-ui-webview2.local/fe/0.1.0/index.html');

function setup(
  frontend: Record<string, unknown> = { version: CURRENT },
  skipped: readonly VersionRef[] = [],
) {
  const host = installFakeHost();
  const store = createStore();
  const files = new Map<string, string>([
    ['current.json', JSON.stringify({ schema: 1, extra: 'keep', frontend })],
  ]);
  for (const ref of [CURRENT, OLD, BAD])
    files.set(
      `fe/${ref.dir}/installed.json`,
      JSON.stringify({
        schema: 1,
        version: ref.v,
        releaseSha256: (ref === BAD ? 'b' : 'a').repeat(64),
        files: { 'index.html': 'f'.repeat(64) },
      }),
    );
  const session: LoaderSession = {
    schema: 1,
    loader: 1,
    sessionId: SESSION_ID,
    version: CURRENT,
    skipped,
  };
  const cookies = new Map([[cookieName(''), JSON.stringify(session)]]);
  let counts = JSON.stringify({
    schema: 1,
    installations: { '': { [CURRENT.dir]: 1, [BAD.dir]: 3 }, [SESSION_ID]: { [OLD.dir]: 2 } },
  });
  const storage: LoaderStorage = {
    readAttempts: () => counts,
    writeAttempts: (next) => {
      counts = next;
    },
    readCookie: (name) => cookies.get(name) ?? null,
    writeCookie: (name, value) => {
      cookies.set(name, value);
    },
    async lock(work, signal) {
      if (signal?.aborted) throw new Error('已取消');
      return work();
    },
  };
  const writes: { path: string; cookies: Map<string, string>; counts: unknown }[] = [];
  const failure: { path: string | null } = { path: null };
  function relative(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith(`${BASE}\\`))
      throw new Error('文件越过主题目录');
    return value.slice(BASE.length + 1).replaceAll('\\', '/');
  }
  host.answer('webview.getSource', {
    success: true,
    source: 'activeTemplate',
    directory: BASE,
    templateName: 'default',
    activeTemplateName: 'default',
    templatesDirectory: 'E:\\themes',
  });
  host.answer('file.read', (params) => {
    const text = files.get(relative(params['path']));
    return text === undefined
      ? hostFailure('OPERATION_FAILED')
      : { success: true, content: text, size: text.length };
  });
  host.answer('file.exists', (params) => ({
    success: true,
    exists: files.has(relative(params['path'])),
    isFile: files.has(relative(params['path'])),
    isDirectory: false,
  }));
  host.answer('file.write', (params) => {
    const path = relative(params['path']);
    writes.push({ path, cookies: new Map(cookies), counts: JSON.parse(counts) });
    if (path === failure.path) return hostFailure('OPERATION_FAILED');
    files.set(path, String(params['content']));
    return { success: true, path: params['path'], bytesWritten: String(params['content']).length };
  });
  const options = {
    storage,
    url: URL,
    readId: async () => files.get('install-id') ?? '',
    randomId: () => ID,
    host: {
      ui: host.fb.ui,
      file: host.fb.file,
      config: host.fb.config,
      getSource: webview.getSource,
    },
  };
  const service = startLoaderConfirmation(store, options);
  onTestFinished(service.dispose);
  return {
    host,
    store,
    files,
    cookies,
    storage,
    writes,
    failure,
    service,
    options,
    state: () => store.get(loaderConfirmationAtom),
    value: (path: string) => json(files.get(path) ?? null),
    counts: () => readAttempts(json(counts)),
  };
}

describe('启动确认', () => {
  it.each([false, true])(
    '虚拟主机读取标识拒绝时，以宿主核对结果决定是否首次发布（已有标识：%s）',
    async (exists) => {
      const env = setup();
      env.service.dispose();
      if (exists) env.files.set('install-id', ID);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const service = startLoaderConfirmation(env.store, { ...env.options, readId: undefined });
      onTestFinished(service.dispose);
      await service.confirm();
      expect(env.state()).toBe(exists ? 'failed' : 'confirmed');
      if (exists) {
        expect(env.writes).toEqual([]);
        expect(env.store.get(confirmedStartupAtom)).toBeNull();
      } else {
        expect(env.files.get('install-id')).toBe(ID);
        expect(env.store.get(confirmedStartupAtom)?.installId).toBe(ID);
      }
    },
  );

  it('安装标识读取超时不能按首次安装处理', async () => {
    const env = setup();
    env.service.dispose();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')),
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const service = startLoaderConfirmation(env.store, { ...env.options, readId: undefined });
    onTestFinished(service.dispose);
    await service.confirm();
    expect(env.state()).toBe('failed');
    expect(env.writes).toEqual([]);
  });

  it('根提交信号之前不工作；首次发布标识前先迁好同一会话与计数', async () => {
    const env = setup();
    expect(env.host.calls).toEqual([]);
    expect(env.state()).toBe('waiting');
    await env.service.confirm();
    expect(env.state()).toBe('confirmed');
    const publishing = env.writes.find((entry) => entry.path === 'install-id');
    expect(publishing).toBeDefined();
    expect(readSession(json(publishing?.cookies.get(cookieName(ID)) ?? null))).toMatchObject({
      sessionId: SESSION_ID,
      version: CURRENT,
      loader: 1,
    });
    expect(readAttempts(publishing?.counts).installations[ID]?.[CURRENT.dir]).toBe(0);
    expect(env.counts().installations[SESSION_ID]?.[OLD.dir]).toBe(2);
    expect(env.files.get('install-id')).toBe(ID);
    expect(env.value('last-good.json')).toEqual(env.value('current.json'));
    expect(env.host.callsTo('file.write').every((params) => params['atomic'] === true)).toBe(true);
    expect(env.store.get(confirmedStartupAtom)).toMatchObject({
      directory: BASE,
      installId: ID,
      session: { sessionId: SESSION_ID, version: CURRENT, loader: 1 },
      plugin: expect.any(String),
    });
    const writes = env.writes.length;
    await env.service.confirm();
    expect(env.writes).toHaveLength(writes);
  });

  it('提升 pending 并留下原当前版；再次确认不覆盖运行中新装的 pending', async () => {
    const env = setup({ version: OLD, pending: CURRENT });
    await env.service.confirm();
    expect(env.value('current.json')).toEqual({
      schema: 1,
      extra: 'keep',
      frontend: { version: CURRENT, previous: OLD },
    });
    expect(env.value('last-good.json')).toEqual(env.value('current.json'));
  });

  it('不把同会话中新出现的 pending 记成坏版本', async () => {
    const env = setup({ version: CURRENT, pending: BAD });
    await env.service.confirm();
    expect(env.value('current.json')).toEqual({
      schema: 1,
      extra: 'keep',
      frontend: { version: CURRENT, pending: BAD },
    });
    expect(env.files.has('state/failed-releases.json')).toBe(false);
  });

  it('回退先写发行身份的坏版本记录，再移除指针引用', async () => {
    const env = setup({ version: BAD, previous: CURRENT }, [BAD]);
    await env.service.confirm();
    expect(env.state()).toBe('confirmed');
    expect(env.value('state/failed-releases.json')).toEqual({
      schema: 1,
      releases: [{ v: BAD.v, releaseSha256: 'b'.repeat(64) }],
    });
    expect(
      env.writes.findIndex((entry) => entry.path === 'state/failed-releases.json'),
    ).toBeLessThan(env.writes.findIndex((entry) => entry.path === 'current.json'));
    expect(env.value('current.json')).toEqual({
      schema: 1,
      extra: 'keep',
      frontend: { version: CURRENT },
    });
    expect(env.counts().installations[ID]?.[BAD.dir]).toBe(3);
  });

  it('坏版本记录写不成时保留原指针，重试成功后才继续', async () => {
    const env = setup({ version: BAD, previous: CURRENT }, [BAD]);
    const before = env.files.get('current.json');
    env.failure.path = 'state/failed-releases.json';
    await env.service.confirm();
    expect(env.state()).toBe('failed');
    expect(env.files.get('current.json')).toBe(before);
    expect(env.files.has('last-good.json')).toBe(false);
    expect(env.files.has('install-id')).toBe(false);
    env.failure.path = null;
    await env.service.confirm();
    expect(env.state()).toBe('confirmed');
    expect(env.value('current.json')).toMatchObject({ frontend: { version: CURRENT } });
  });

  it('坏版本记录损坏时不覆盖它，也不改指针', async () => {
    const env = setup({ version: BAD, previous: CURRENT }, [BAD]);
    env.files.set('state/failed-releases.json', '{broken');
    const before = env.files.get('current.json');
    await env.service.confirm();
    expect(env.state()).toBe('failed');
    expect(env.files.get('state/failed-releases.json')).toBe('{broken');
    expect(env.files.get('current.json')).toBe(before);
  });

  it('没有发行身份的本地版本不伪造拉黑记录、不丢引用', async () => {
    const env = setup({ version: BAD, previous: CURRENT }, [BAD]);
    env.files.set(
      `fe/${BAD.dir}/installed.json`,
      JSON.stringify({ schema: 1, version: BAD.v, files: { 'index.html': 'f'.repeat(64) } }),
    );
    const before = env.files.get('current.json');
    await env.service.confirm();
    expect(env.state()).toBe('failed');
    expect(env.files.get('current.json')).toBe(before);
    expect(env.files.has('state/failed-releases.json')).toBe(false);
  });

  it('current 损坏时从 last-good 恢复；未知字段保留', async () => {
    const env = setup();
    env.files.set('last-good.json', env.files.get('current.json') ?? '');
    env.files.set('current.json', 'broken');
    await env.service.confirm();
    expect(env.state()).toBe('confirmed');
    expect(env.value('current.json')).toEqual({
      schema: 1,
      extra: 'keep',
      frontend: { version: CURRENT },
    });
  });

  it('发布安装标识失败后沿用空标识，重试仍迁同一会话', async () => {
    const env = setup();
    env.failure.path = 'install-id';
    await env.service.confirm();
    expect(env.state()).toBe('failed');
    expect(env.files.has('install-id')).toBe(false);
    expect(readSession(json(env.cookies.get(cookieName('')) ?? null))?.sessionId).toBe(SESSION_ID);
    env.failure.path = null;
    await env.service.confirm();
    expect(env.state()).toBe('confirmed');
    expect(readSession(json(env.cookies.get(cookieName(ID)) ?? null))?.sessionId).toBe(SESSION_ID);
  });

  it('弹窗不清计数、不写指针；面板说明只清计数', async () => {
    const env = setup();
    env.host.answer('window.getCurrentWindowId', { success: true, windowId: 'popup-1' });
    const counts = env.storage.readAttempts();
    await env.service.confirm();
    expect(env.state()).toBe('disabled');
    expect(env.store.get(confirmedStartupAtom)).toBeNull();
    expect(env.storage.readAttempts()).toBe(counts);
    expect(env.writes).toEqual([]);
    expect(await clearPanelStartup(env.options)).toBe(true);
    expect(env.counts().installations['']?.[CURRENT.dir]).toBe(0);
    expect(env.writes).toEqual([]);
  });

  it.each(['devServer', 'url', 'componentDirectory'] as const)(
    '来源 %s 不写版本文件，但仍清零已启动的计数',
    async (source) => {
      const env = setup();
      env.host.answer('webview.getSource', {
        success: true,
        source,
        directory: BASE,
        activeTemplateName: 'default',
        templatesDirectory: 'E:\\themes',
      });
      await env.service.confirm();
      expect(env.state()).toBe('disabled');
      expect(env.store.get(confirmedStartupAtom)).toBeNull();
      expect(env.counts().installations['']?.[CURRENT.dir]).toBe(0);
      expect(env.writes).toEqual([]);
    },
  );

  it('旧宿主不尝试原子写，释放后拒收迟到结果', async () => {
    const env = setup();
    const info = await env.host.fb.config.getVersionInfo();
    if (info.success === false) throw new Error('版本应答失败');
    env.host.answer('config.getVersionInfo', {
      ...info,
      plugin: { ...info.plugin, version: '1.13.0' },
    });
    const held = env.host.hold('window.getCurrentWindowId');
    const pending = env.service.confirm();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.service.dispose();
    held.release();
    await pending;
    expect(env.writes).toEqual([]);
    expect(env.state()).toBe('waiting');
    const other = startLoaderConfirmation(env.store, env.options);
    onTestFinished(other.dispose);
    await other.confirm();
    expect(env.state()).toBe('disabled');
    expect(env.writes).toEqual([]);
  });
});
