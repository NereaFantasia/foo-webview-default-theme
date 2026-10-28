import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startOnlineSearch } from '../../../../../src/library/search/online/onlineSearch.ts';
import { startMusicClient } from '../../../../../src/playback/musicClient.ts';
import { BackendRequestError } from '../../../../../src/server/backendConnection.ts';
import type { MusicPlatform } from '../../../../../src/server/musicObjects.ts';
import { musicAlbum, musicTrack } from '../../../../fixtures/music.ts';

interface Call {
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly signal: AbortSignal | undefined;
  answer(data: unknown): void;
  fail(code: string): void;
  /** 后端还没连上：请求当即被拒，不是后端答的失败。 */
  unreachable(): void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const platform = atom<MusicPlatform>('wy');
  const calls: Call[] = [];
  const client = startMusicClient({
    request: (path, body, options) =>
      new Promise((resolve, reject) => {
        calls.push({
          path,
          body: { ...(body as Record<string, unknown>) },
          signal: options?.signal,
          answer: (data) => resolve({ protocol: 1, success: true, data }),
          fail: (code) =>
            reject(
              new BackendRequestError(400, {
                protocol: 1,
                success: false,
                error: { code, message: code },
              }),
            ),
          unreachable: () => reject(new Error('本地后端尚未连接')),
        });
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
      }),
  });
  const store = createStore();
  const port = atom<number | null>(null);
  const search = startOnlineSearch(store, client, port, platform);
  onTestFinished(() => {
    search.dispose();
    client.dispose();
  });
  return { calls, store, port, search, platform };
}

const page = (items: unknown[], nextCursor: string | null, total: number | null = 40) => ({
  items,
  nextCursor,
  total,
  discardedCount: 0,
});

describe('在线搜索', () => {
  it('换词不发请求；按类别取第一页，已取到的不重取', async () => {
    const { calls, store, search } = setup();
    search.setText('Nujabes');
    expect(calls).toHaveLength(0);
    search.load(['track', 'album']);
    expect(calls.map((call) => call.body)).toEqual([
      { platform: 'wy', kind: 'track', query: 'Nujabes', cursor: null },
      { platform: 'wy', kind: 'album', query: 'Nujabes', cursor: null },
    ]);
    expect(store.get(search.kinds.track).status).toBe('loading');
    calls[0]?.answer(page([musicTrack('1')], '20'));
    calls[1]?.answer(page([musicAlbum('2')], null, 1));
    await settle();
    expect(store.get(search.kinds.track)).toMatchObject({
      status: 'ready',
      items: [{ ref: { id: '1' } }],
      total: 40,
      cursor: '20',
    });
    expect(store.get(search.kinds.album)).toMatchObject({
      status: 'ready',
      total: 1,
      cursor: null,
    });
    search.load(['track', 'album', 'artist']);
    expect(calls.map((call) => call.body['kind'])).toEqual(['track', 'album', 'artist']);
  });

  it('第一页失败记下原因，再要时重取', async () => {
    const { calls, store, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    calls[0]?.fail('not-installed');
    await settle();
    expect(store.get(search.kinds.track)).toMatchObject({
      status: 'failed',
      failure: 'not-installed',
      items: [],
    });
    search.load(['track']);
    expect(calls).toHaveLength(2);
  });

  it('续页接在后面并去掉重复的条目；续页失败不抹掉已有的', async () => {
    const { calls, store, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    calls[0]?.answer(page([musicTrack('1'), musicTrack('2')], '2'));
    await settle();
    const more = search.more('track');
    expect(calls[1]?.body['cursor']).toBe('2');
    expect(store.get(search.kinds.track).loadingMore).toBe(true);
    void search.more('track');
    expect(calls).toHaveLength(2);
    calls[1]?.answer(page([musicTrack('2'), musicTrack('3')], '4', 41));
    await more;
    expect(store.get(search.kinds.track)).toMatchObject({
      items: [{ ref: { id: '1' } }, { ref: { id: '2' } }, { ref: { id: '3' } }],
      cursor: '4',
      total: 41,
      loadingMore: false,
    });
    const failed = search.more('track');
    calls[2]?.fail('timeout');
    await failed;
    expect(store.get(search.kinds.track)).toMatchObject({ moreFailed: true, loadingMore: false });
    expect(store.get(search.kinds.track).items).toHaveLength(3);
  });

  it('没有下一页或第一页还没到时不续取；空词不发请求', async () => {
    const { calls, search } = setup();
    search.setText('   ');
    search.load(['track']);
    expect(calls).toHaveLength(0);
    search.setText('Nujabes');
    await search.more('track');
    search.load(['track']);
    calls[0]?.answer(page([musicTrack('1')], null));
    await settle();
    await search.more('track');
    expect(calls).toHaveLength(1);
  });

  it('换词取消在途请求，晚到的应答不写进新词的结果', async () => {
    const { calls, store, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    const old = calls[0];
    search.setText('Shing02');
    expect(old?.signal?.aborted).toBe(true);
    expect(store.get(search.text)).toBe('Shing02');
    expect(store.get(search.kinds.track).status).toBe('idle');
    old?.answer(page([musicTrack('9')], null));
    await settle();
    expect(store.get(search.kinds.track).status).toBe('idle');
  });

  it('后端还没连上时没取到的类别，连上后自己重取；上游失败的不重取', async () => {
    const { calls, store, port, search } = setup();
    search.setText('Nujabes');
    search.load(['track', 'album']);
    calls[0]?.unreachable();
    calls[1]?.fail('upstream-unavailable');
    await settle();
    expect(store.get(search.kinds.track)).toMatchObject({
      status: 'failed',
      failure: 'backend-unavailable',
    });
    store.set(port, 51234);
    await settle();
    expect(calls.map((call) => call.body['kind'])).toEqual(['track', 'album', 'track']);
    expect(store.get(search.kinds.track).status).toBe('loading');
    expect(store.get(search.kinds.album).status).toBe('failed');
  });
});

describe('在线搜索按平台分开', () => {
  const track = (id: string) => musicTrack(id, { ref: { platform: 'kw', id } });

  it('换平台后读的是那个平台的结果：已取到的不重取，没取过的才发请求', async () => {
    const { calls, store, platform, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    calls[0]?.answer(page([musicTrack('1')], null));
    await settle();
    store.set(platform, 'kw');
    expect(store.get(search.platform)).toBe('kw');
    expect(store.get(search.kinds.track).status).toBe('idle');
    search.load(['track']);
    expect(calls[1]?.body).toEqual({
      platform: 'kw',
      kind: 'track',
      query: 'Nujabes',
      cursor: null,
    });
    calls[1]?.answer(page([track('7')], '2', null));
    await settle();
    expect(store.get(search.kinds.track)).toMatchObject({
      status: 'ready',
      items: [{ ref: { id: '7' } }],
      total: null,
      cursor: '2',
    });
    store.set(platform, 'wy');
    expect(store.get(search.kinds.track)).toMatchObject({ items: [{ ref: { id: '1' } }] });
    search.load(['track']);
    expect(calls).toHaveLength(2);
  });

  it('其他平台只搜曲目：别的类别不发请求，也不进失败', async () => {
    const { calls, store, platform, search } = setup();
    store.set(platform, 'kg');
    search.setText('Nujabes');
    search.load(['track', 'album', 'artist', 'playlist']);
    expect(calls.map((call) => call.body['kind'])).toEqual(['track']);
    expect(store.get(search.kinds.album).status).toBe('idle');
    await search.more('album');
    expect(calls).toHaveLength(1);
  });

  it('切走后晚到的应答写进它自己那个平台，不写进当前平台', async () => {
    const { calls, store, platform, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    store.set(platform, 'kw');
    search.load(['track']);
    calls[0]?.answer(page([musicTrack('1')], null));
    await settle();
    expect(store.get(search.kinds.track).status).toBe('loading');
    calls[1]?.answer(page([track('7')], null));
    await settle();
    expect(store.get(search.kinds.track)).toMatchObject({ items: [{ ref: { id: '7' } }] });
    store.set(platform, 'wy');
    expect(store.get(search.kinds.track)).toMatchObject({ items: [{ ref: { id: '1' } }] });
  });

  it('续页只续当前平台，游标不串', async () => {
    const { calls, store, platform, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    calls[0]?.answer(page([musicTrack('1')], 'wy-2'));
    store.set(platform, 'kw');
    search.load(['track']);
    calls[1]?.answer(page([track('7')], 'kw-2'));
    await settle();
    void search.more('track');
    expect(calls[2]?.body).toEqual({
      platform: 'kw',
      kind: 'track',
      query: 'Nujabes',
      cursor: 'kw-2',
    });
  });

  it('换词时各平台的结果一起清空，在途请求一起取消', async () => {
    const { calls, store, platform, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    calls[0]?.answer(page([musicTrack('1')], null));
    await settle();
    store.set(platform, 'kw');
    search.load(['track']);
    const pending = calls[1];
    search.setText('Shing02');
    expect(pending?.signal?.aborted).toBe(true);
    expect(store.get(search.kinds.track).status).toBe('idle');
    store.set(platform, 'wy');
    expect(store.get(search.kinds.track).status).toBe('idle');
  });

  it('后端连上后只重取当前平台因后端没连上而失败的类别', async () => {
    const { calls, store, port, platform, search } = setup();
    search.setText('Nujabes');
    search.load(['track']);
    calls[0]?.unreachable();
    await settle();
    store.set(platform, 'kw');
    search.load(['track']);
    calls[1]?.unreachable();
    await settle();
    store.set(port, 51234);
    await settle();
    expect(calls.map((call) => call.body['platform'])).toEqual(['wy', 'kw', 'kw']);
  });
});
