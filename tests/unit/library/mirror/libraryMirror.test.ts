import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  LIBRARY_MIRROR_PREF_KEY,
  startLibraryMirror,
} from '../../../../src/library/mirror/libraryMirror.ts';
import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

type Handler = (body: unknown) => unknown;

const STATUS = { schema: 1, epoch: '', revision: 0, count: 0, ready: false, bytes: 0 };

function setup(
  options: { port?: number | null; config?: Readonly<Record<string, ConfigValue>> } = {},
) {
  const host = installFakeHost({ config: options.config ?? {} });
  const store = createStore();
  const port = atom<number | null>(options.port === undefined ? null : options.port);
  const failed = atom(false);
  const handlers = new Map<string, Handler>();
  const request = vi.fn(async (path: string, body?: unknown) => {
    const handler = handlers.get(path);
    if (!handler) throw new Error(`没有 ${path}`);
    return handler(body);
  });
  const mirror = startLibraryMirror(
    store,
    { request, port, failed },
    host.fb,
    createMemoryConfigWriter(host.fb),
  );
  onTestFinished(() => mirror.dispose());
  return {
    host,
    store,
    port,
    failed,
    request,
    mirror,
    on: (path: string, handler: Handler) => handlers.set(path, handler),
    calls: (path: string) => request.mock.calls.filter(([called]) => called === path),
  };
}

describe('读镜像前等后端连上', () => {
  it('后端还没连上时先等，连上后才发请求', async () => {
    vi.useFakeTimers();
    const { store, port, request, mirror } = setup();
    const reading = mirror.albums();
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).not.toHaveBeenCalled();
    store.set(port, 5000);
    expect(await reading).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('连接已经失败就不等，直接答 null', async () => {
    const { store, failed, request, mirror } = setup();
    store.set(failed, true);
    expect(await mirror.albums()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('等满上限还没连上就答 null，之后的读取不再等', async () => {
    vi.useFakeTimers();
    const { request, mirror } = setup();
    const first = mirror.albums();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await first).toBeNull();
    expect(await mirror.albums()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('已经连着时不等', async () => {
    const { request, mirror } = setup({ port: 5000 });
    expect(await mirror.albums()).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('开关', () => {
  it('缺省开着；存档里关着时读取不发任何请求', async () => {
    const on = setup({ port: 5000 });
    await on.mirror.ready;
    expect(on.store.get(on.mirror.enabled)).toBe(true);
    const off = setup({
      port: 5000,
      config: { [LIBRARY_MIRROR_PREF_KEY]: { version: 1, enabled: false } },
    });
    await off.mirror.ready;
    expect(off.store.get(off.mirror.enabled)).toBe(false);
    expect(await off.mirror.albums()).toBeNull();
    expect(await off.mirror.tracks()).toBeNull();
    expect(off.request).not.toHaveBeenCalled();
  });

  it('关掉之后读取退回宿主，重新打开又读镜像', async () => {
    const { store, request, mirror } = setup({ port: 5000 });
    await mirror.ready;
    expect(await mirror.setEnabled(false)).toBe(true);
    expect(store.get(mirror.enabled)).toBe(false);
    expect(await mirror.albums()).toBeNull();
    expect(request).not.toHaveBeenCalled();
    await mirror.setEnabled(true);
    await mirror.albums();
    expect(request).toHaveBeenCalled();
  });
});

describe('占用与重建', () => {
  it('占用读后端的状态：曲目数、磁盘字节数、有没有建好', async () => {
    const { store, mirror, on } = setup({ port: 5000 });
    on('/library/status', () => ({ ...STATUS, count: 2753, bytes: 7_340_032, ready: true }));
    await mirror.refreshUsage();
    expect(store.get(mirror.usage)).toEqual({
      status: 'ready',
      count: 2753,
      bytes: 7_340_032,
      built: true,
    });
  });

  it('读不到状态就报读取失败；后端没连着时不读', async () => {
    const down = setup();
    await down.mirror.refreshUsage();
    expect(down.request).not.toHaveBeenCalled();
    const { store, mirror } = setup({ port: 5000 });
    await mirror.refreshUsage();
    expect(store.get(mirror.usage)).toEqual({ status: 'failed' });
  });

  it('重建先让后端丢掉镜像，再催同步，最后刷新占用', async () => {
    const { store, mirror, on, calls } = setup({ port: 5000 });
    on('/library/clear', () => ({ success: true }));
    on('/library/status', () => STATUS);
    expect(await mirror.rebuild()).toBe(true);
    expect(calls('/library/clear')).toHaveLength(1);
    expect(store.get(mirror.usage)).toMatchObject({ status: 'ready', built: false });
  });

  it('后端清不掉时报重建失败；开关关着或后端没连着时不动手', async () => {
    const { store, mirror, on } = setup({ port: 5000 });
    on('/library/clear', () => {
      throw new Error('清不掉');
    });
    expect(await mirror.rebuild()).toBe(false);
    expect(store.get(mirror.usage)).toEqual({ status: 'rebuild-failed' });
    const down = setup();
    expect(await down.mirror.rebuild()).toBe(false);
    expect(down.request).not.toHaveBeenCalled();
    const off = setup({ port: 5000 });
    await off.mirror.setEnabled(false);
    expect(await off.mirror.rebuild()).toBe(false);
    expect(off.calls('/library/clear')).toHaveLength(0);
  });
});
