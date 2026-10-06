import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeHost, type HostParams, type HostResponse } from '../fixtures/fakeHost.ts';
import { HOST_VERSION, hostFailure, numberParam } from '../fixtures/hostAnswers.ts';

afterEach(() => {
  vi.useRealTimers();
});

function albums(params: HostParams): HostResponse<'library.getAlbums'> {
  return {
    success: true,
    albums: [],
    total: 0,
    offset: 0,
    limit: numberParam(params, 'limit') ?? 0,
    hasMore: false,
    includeCover: false,
    fromCache: false,
  };
}

describe('FakeHost 应答', () => {
  it('按方法名答缺省应答，调用按到达先后记下，参数过 JSON', async () => {
    const host = new FakeHost();
    const version = await host.invoke('config.getVersionInfo');
    expect(version).toMatchObject({ success: true, plugin: { version: HOST_VERSION } });
    await host.invoke('library.getAlbums', { limit: 5, query: undefined });
    expect(host.calls.map((call) => call.method)).toEqual([
      'config.getVersionInfo',
      'library.getAlbums',
    ]);
    expect(host.callsTo('library.getAlbums')).toEqual([{ limit: 5 }]);
  });

  it('选项里的应答表与 answer() 都盖过缺省应答；每次答的是副本', async () => {
    const host = new FakeHost({
      answers: { library: { isEnabled: { success: true, enabled: false } } },
    });
    expect(await host.invoke('library.isEnabled')).toEqual({ success: true, enabled: false });
    host.answer('library.getAlbums', albums);
    const first = await host.invoke('library.getAlbums', { limit: 7 });
    expect(first).toMatchObject({ limit: 7 });
    expect(first).not.toBe(await host.invoke('library.getAlbums', { limit: 7 }));
  });

  it('失败信封照常 resolve', async () => {
    const host = new FakeHost({
      answers: { playlist: { setActive: hostFailure('LOCKED', 'playlist is locked') } },
    });
    await expect(host.invoke('playlist.setActive', { playlist: 0 })).resolves.toEqual({
      success: false,
      error: 'playlist is locked',
      code: 'LOCKED',
    });
  });

  it('应答函数抛错时 reject，没配应答的方法也 reject', async () => {
    const host = new FakeHost();
    host.answer('config.getVersionInfo', () => {
      throw new Error('Request timeout');
    });
    await expect(host.invoke('config.getVersionInfo')).rejects.toThrow('Request timeout');
    await expect(host.invoke('dsp.getChain')).rejects.toThrow('dsp.getChain');
  });
});

describe('FakeHost 延迟与扣留', () => {
  it('delayMs 让应答晚到；已经在路上的调用按收到时的配置答', async () => {
    vi.useFakeTimers();
    const host = new FakeHost();
    const settled: number[] = [];
    host.answer('library.getAlbums', albums, { delayMs: 300 });
    void host.invoke('library.getAlbums', { limit: 1 }).then(() => settled.push(1));
    host.answer('library.getAlbums', albums);
    void host.invoke('library.getAlbums', { limit: 2 }).then(() => settled.push(2));
    await vi.advanceTimersByTimeAsync(299);
    expect(settled).toEqual([2]);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual([2, 1]);
  });

  it('hold 扣下的调用由测试决定先后与应答', async () => {
    const host = new FakeHost();
    host.answer('library.getAlbums', albums);
    const held = host.hold('library.getAlbums');
    const first = host.invoke('library.getAlbums', { limit: 1 });
    const second = host.invoke('library.getAlbums', { limit: 2 });
    expect(held.pending).toEqual([{ limit: 1 }, { limit: 2 }]);
    held.respond(1, hostFailure('OPERATION_FAILED'));
    await expect(second).resolves.toMatchObject({ success: false, code: 'OPERATION_FAILED' });
    expect(held.pending).toEqual([{ limit: 1 }]);
    held.respond(0);
    await expect(first).resolves.toMatchObject({ success: true, limit: 1 });
    expect(() => held.respond(0)).toThrow();
  });

  it('release 按先后放行剩下的，之后的调用不再扣下', async () => {
    const host = new FakeHost();
    host.answer('library.getAlbums', albums);
    const held = host.hold('library.getAlbums');
    const order: number[] = [];
    const first = host.invoke('library.getAlbums', { limit: 1 }).then(() => order.push(1));
    const second = host.invoke('library.getAlbums', { limit: 2 }).then(() => order.push(2));
    held.release();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
    await expect(host.invoke('library.getAlbums', { limit: 3 })).resolves.toMatchObject({
      limit: 3,
    });
  });
});

describe('FakeHost 参数键', () => {
  const unknownKey = (key: string) => ({
    success: false,
    error: `unknown parameter '${key}'`,
    code: 'INVALID_PARAMS',
  });

  it('未声明的顶层键答 INVALID_PARAMS；下划线开头的键是桥接层的，放行', async () => {
    const host = new FakeHost();
    expect(await host.invoke('library.getAlbums', { limit: 5, sortBy: 'name' })).toEqual(
      unknownKey('sortBy'),
    );
    expect(await host.invoke('library.getAlbums', { limit: 5, _callerHwnd: 1 })).toMatchObject({
      success: true,
    });
  });

  it('值为 null 的未声明键照样被拒，值为 undefined 的键过 JSON 后已经没了', async () => {
    const host = new FakeHost();
    expect(await host.invoke('library.search', { query: 'a', page: null })).toEqual(
      unknownKey('page'),
    );
    expect(await host.invoke('library.search', { query: 'a', page: undefined })).toMatchObject({
      success: true,
    });
  });

  it('对象数组逐项查嵌套的键，报错带下标', async () => {
    const host = new FakeHost();
    const items = [
      { playlist: 0, item: 1 },
      { playlist: 0, item: 2, path: 'E:/a.flac' },
    ];
    expect(await host.invoke('queue.insertNext', { items })).toEqual(unknownKey('items[1].path'));
  });

  it('每个声明过的方法都查，不只是调用方能塞键的那些', async () => {
    const host = new FakeHost();
    expect(await host.invoke('playlist.clear', { playlist: 0, force: true })).toEqual(
      unknownKey('force'),
    );
  });

  it('缺了必填键答 INVALID_PARAMS，值为 null 的必填键也算缺；嵌套对象里的必填键带路径', async () => {
    const host = new FakeHost();
    const required = (path: string) => ({
      success: false,
      error: `${path} is required`,
      code: 'INVALID_PARAMS',
    });
    expect(await host.invoke('config.get', {})).toEqual(required('key'));
    expect(await host.invoke('config.set', { key: 'a', value: null })).toEqual(required('value'));
    expect(await host.invoke('queue.insertNext', { items: [{ playlist: 0 }] })).toEqual(
      required('items[0].item'),
    );
  });

  it('该是对象的值不是对象时，报错带上它的位置', async () => {
    const host = new FakeHost();
    expect(await host.invoke('queue.insertNext', { items: [7] })).toEqual({
      success: false,
      error: 'items[0] must be an object',
      code: 'INVALID_PARAMS',
    });
  });

  it('参数不是对象时答 INVALID_PARAMS', async () => {
    const host = new FakeHost();
    expect(await host.invoke('library.getAlbums', [1, 2])).toEqual({
      success: false,
      error: 'params must be an object',
      code: 'INVALID_PARAMS',
    });
  });
});

describe('FakeHost config 存储', () => {
  it('set 后 get 读回，remove 报是否存在；初值来自选项', async () => {
    const host = new FakeHost({ config: { 'defaultTheme.browser.style': 'grid' } });
    expect(await host.invoke('config.get', { key: 'defaultTheme.browser.style' })).toEqual({
      success: true,
      key: 'defaultTheme.browser.style',
      value: 'grid',
      found: true,
    });
    await host.invoke('config.set', { key: 'defaultTheme.sort', value: { by: 'year' } });
    expect(host.config.get('defaultTheme.sort')).toEqual({ by: 'year' });
    expect(await host.invoke('config.remove', { key: 'defaultTheme.sort' })).toMatchObject({
      existed: true,
    });
    expect(await host.invoke('config.get', { key: 'defaultTheme.sort' })).toMatchObject({
      value: null,
      found: false,
    });
  });

  it('顶层 null 答 INVALID_PARAMS，不落盘', async () => {
    const host = new FakeHost();
    expect(await host.invoke('config.set', { key: 'defaultTheme.x', value: null })).toMatchObject({
      success: false,
      code: 'INVALID_PARAMS',
    });
    expect(host.config.has('defaultTheme.x')).toBe(false);
  });
});
