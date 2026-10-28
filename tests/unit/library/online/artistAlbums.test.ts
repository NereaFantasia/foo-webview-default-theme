import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  ARTIST_ALBUMS_EAGER,
  ARTIST_ALBUMS_LIMIT,
  ARTIST_ALBUMS_STEP,
  artistAlbumsKeyOf,
  startArtistAlbums,
} from '../../../../src/library/online/artistAlbums.ts';
import { startMusicClient } from '../../../../src/playback/musicClient.ts';
import { BackendRequestError } from '../../../../src/server/backendConnection.ts';
import type { MusicRef } from '../../../../src/server/musicObjects.ts';
import { musicAlbum } from '../../../fixtures/music.ts';

interface Call {
  readonly body: Record<string, unknown>;
  readonly signal: AbortSignal | undefined;
  answer(data: unknown): void;
  fail(code: string): void;
  /** 后端还没连上：请求当即被拒，不是后端答的失败 */
  unreachable(): void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const artist = (id: string): MusicRef => ({ platform: 'wy', id });

function setup() {
  const calls: Call[] = [];
  const client = startMusicClient({
    request: (_path, body, options) =>
      new Promise((resolve, reject) => {
        calls.push({
          body: { ...(body as Record<string, unknown>) },
          signal: options?.signal,
          answer: (data) => resolve({ protocol: 1, success: true, data }),
          fail: (code) =>
            reject(
              new BackendRequestError(503, {
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
  const service = startArtistAlbums(store, client, port);
  onTestFinished(() => {
    service.dispose();
    client.dispose();
  });
  const stateOf = (ref: MusicRef) => store.get(service.artists).get(artistAlbumsKeyOf(ref));
  return { calls, store, port, service, stateOf };
}

const page = (ids: string[], nextCursor: string | null, total: number | null) => ({
  items: ids.map((id) => musicAlbum(id)),
  nextCursor,
  total,
  discardedCount: 0,
});
const ids = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => String(from + index));

describe('艺人专辑数据', () => {
  it('第一页到了就显示，后面的页串行接着取到没有下一页', async () => {
    const { calls, service, stateOf } = setup();
    service.want(artist('3'));
    expect(stateOf(artist('3'))).toMatchObject({ phase: 'loading' });
    expect(calls[0]?.body).toEqual({ ref: artist('3'), cursor: null });
    calls[0]?.answer(page(['1', '2'], '2', 5));
    await settle();
    expect(stateOf(artist('3'))).toMatchObject({
      phase: 'ready',
      total: 5,
      cursor: '2',
      loadingMore: true,
    });
    expect(stateOf(artist('3'))?.albums.map((album) => album.ref.id)).toEqual(['1', '2']);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toEqual({ ref: artist('3'), cursor: '2' });
    // 上一页没答完不发下一页
    await settle();
    expect(calls).toHaveLength(2);
    calls[1]?.answer(page(['2', '3', '4'], null, 5));
    await settle();
    expect(stateOf(artist('3'))).toMatchObject({
      phase: 'ready',
      cursor: null,
      loadingMore: false,
      truncated: false,
    });
    // 重复的专辑只留一张
    expect(stateOf(artist('3'))?.albums.map((album) => album.ref.id)).toEqual(['1', '2', '3', '4']);
    expect(calls).toHaveLength(2);
  });

  it('几处同时要同一位只取一次，放手后留着，回来不重取', async () => {
    const { calls, service, stateOf } = setup();
    const first = service.want(artist('3'));
    const second = service.want(artist('3'));
    expect(calls).toHaveLength(1);
    calls[0]?.answer(page(['1'], null, 1));
    await settle();
    first();
    second();
    service.want(artist('3'))();
    expect(calls).toHaveLength(1);
    expect(stateOf(artist('3'))).toMatchObject({ phase: 'ready' });
  });

  it('自动取到 1000 张就停下，滚动到底才续取，每次一页，一直取到上限记下还有没取的', async () => {
    const { calls, service, stateOf } = setup();
    service.want(artist('3'));
    for (let round = 0; round < ARTIST_ALBUMS_EAGER / 200; round++) {
      calls[round]?.answer(page(ids(round * 200 + 1, 200), String((round + 1) * 200), 15177));
      await settle();
    }
    expect(calls).toHaveLength(ARTIST_ALBUMS_EAGER / 200);
    expect(stateOf(artist('3'))).toMatchObject({
      paused: true,
      truncated: false,
      loadingMore: false,
      cursor: String(ARTIST_ALBUMS_EAGER),
      total: 15177,
    });
    // 没停下时续取不动；停下后续取一页，取完又停下
    service.more(artist('4'));
    expect(calls).toHaveLength(ARTIST_ALBUMS_EAGER / 200);
    service.more(artist('3'));
    expect(calls).toHaveLength(ARTIST_ALBUMS_EAGER / 200 + 1);
    expect(calls.at(-1)?.body).toEqual({ ref: artist('3'), cursor: String(ARTIST_ALBUMS_EAGER) });
    expect(stateOf(artist('3'))).toMatchObject({ paused: false, loadingMore: true });
    service.more(artist('3'));
    expect(calls).toHaveLength(ARTIST_ALBUMS_EAGER / 200 + 1);
    calls.at(-1)?.answer(page(ids(ARTIST_ALBUMS_EAGER + 1, 200), '1200', 15177));
    await settle();
    expect(stateOf(artist('3'))).toMatchObject({ paused: true, loadingMore: false });
    expect(stateOf(artist('3'))?.albums).toHaveLength(ARTIST_ALBUMS_EAGER + ARTIST_ALBUMS_STEP);
    for (
      let loaded = ARTIST_ALBUMS_EAGER + ARTIST_ALBUMS_STEP;
      loaded < ARTIST_ALBUMS_LIMIT;
      loaded += ARTIST_ALBUMS_STEP
    ) {
      service.more(artist('3'));
      calls.at(-1)?.answer(page(ids(loaded + 1, 200), String(loaded + 200), 15177));
      await settle();
    }
    expect(stateOf(artist('3'))).toMatchObject({
      truncated: true,
      paused: false,
      loadingMore: false,
    });
    expect(stateOf(artist('3'))?.albums).toHaveLength(ARTIST_ALBUMS_LIMIT);
    const asked = calls.length;
    service.more(artist('3'));
    expect(calls).toHaveLength(asked);
  });

  it('没人看了就不再往下取，回来从断处接着取', async () => {
    const { calls, service, stateOf } = setup();
    const release = service.want(artist('3'));
    calls[0]?.answer(page(ids(1, 200), '200', 900));
    await settle();
    expect(calls).toHaveLength(2);
    release();
    calls[1]?.answer(page(ids(201, 200), '400', 900));
    await settle();
    expect(calls).toHaveLength(2);
    expect(stateOf(artist('3'))).toMatchObject({ cursor: '400', loadingMore: false });
    service.want(artist('3'));
    expect(calls).toHaveLength(3);
    expect(calls[2]?.body).toEqual({ ref: artist('3'), cursor: '400' });
  });

  it('第一页失败时记下原因，重试重取；放手后只留 4 位，更早的丢掉', async () => {
    const { calls, service, stateOf } = setup();
    const release = service.want(artist('3'));
    calls[0]?.fail('rate-limited');
    await settle();
    expect(stateOf(artist('3'))).toMatchObject({ phase: 'failed', failure: 'rate-limited' });
    service.retry(artist('3'));
    expect(calls).toHaveLength(2);
    calls[1]?.answer(page(['1'], null, 1));
    await settle();
    expect(stateOf(artist('3'))).toMatchObject({ phase: 'ready', failure: null });
    release();
    for (const id of ['10', '11', '12']) {
      const leave = service.want(artist(id));
      calls.at(-1)?.answer(page([id], null, 1));
      await settle();
      leave();
    }
    expect(stateOf(artist('3'))).toBeDefined();
    const last = service.want(artist('13'));
    calls.at(-1)?.answer(page(['13'], null, 1));
    await settle();
    last();
    expect(stateOf(artist('3'))).toBeUndefined();
    expect(stateOf(artist('10'))).toBeDefined();
  });

  it('后面的页失败时保留已取到的，重试从断处接着取', async () => {
    const { calls, service, stateOf } = setup();
    service.want(artist('3'));
    calls[0]?.answer(page(['1', '2'], '2', 4));
    await settle();
    calls[1]?.fail('rate-limited');
    await settle();
    expect(stateOf(artist('3'))).toMatchObject({
      phase: 'ready',
      moreFailed: true,
      loadingMore: false,
      cursor: '2',
    });
    expect(stateOf(artist('3'))?.albums).toHaveLength(2);
    expect(calls).toHaveLength(2);
    service.retry(artist('3'));
    expect(stateOf(artist('3'))).toMatchObject({ moreFailed: false });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.body).toEqual({ ref: artist('3'), cursor: '2' });
    calls[2]?.answer(page(['3', '4'], null, 4));
    await settle();
    expect(stateOf(artist('3'))?.albums).toHaveLength(4);
  });

  it('后端连上之前没取到的，连上后自己重取；上游失败不自动重取', async () => {
    const { calls, store, port, service, stateOf } = setup();
    service.want(artist('3'));
    service.want(artist('4'));
    calls[0]?.unreachable();
    calls[1]?.fail('upstream-unavailable');
    await settle();
    expect(stateOf(artist('3'))).toMatchObject({ failure: 'backend-unavailable' });
    expect(stateOf(artist('4'))).toMatchObject({ failure: 'upstream-unavailable' });
    store.set(port, 5000);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.body).toEqual({ ref: artist('3'), cursor: null });
  });
});
