import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startMusicClient } from '../../../src/playback/musicClient.ts';
import {
  onlineListKey,
  startOnlineLists,
  type OnlineList,
} from '../../../src/playback/onlineLists.ts';
import { BackendRequestError } from '../../../src/server/backendConnection.ts';
import { musicAlbum, musicPlaylist, musicTrack } from '../../fixtures/music.ts';

interface Call {
  readonly body: Record<string, unknown>;
  readonly signal: AbortSignal | undefined;
  answer(data: unknown): void;
  fail(code: string): void;
  /** 后端还没连上：请求当即被拒，不是后端答的失败。 */
  unreachable(): void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  const lists = startOnlineLists(store, client, port);
  onTestFinished(() => {
    lists.dispose();
    client.dispose();
  });
  const stateOf = (list: OnlineList) => store.get(lists.lists).get(onlineListKey(list));
  return { calls, store, port, lists, stateOf };
}

const album = (id: string): OnlineList => ({ kind: 'album', ref: { platform: 'wy', id } });
const playlist: OnlineList = { kind: 'playlist', ref: { platform: 'wy', id: '9' } };
const page = (owner: unknown, ids: string[], nextCursor: string | null, total: number | null) => ({
  owner,
  items: ids.map((id) => musicTrack(id)),
  nextCursor,
  total,
  discardedCount: 0,
});

describe('在线列表数据', () => {
  it('几处同时要同一张只取一次，放手后留着，回来不重取', async () => {
    const { calls, lists, stateOf } = setup();
    const first = lists.want(album('5'));
    const second = lists.want(album('5'));
    expect(stateOf(album('5'))).toMatchObject({ phase: 'loading' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      kind: 'album',
      ref: { platform: 'wy', id: '5' },
      cursor: null,
    });
    calls[0]?.answer(page(musicAlbum('5'), ['1', '2'], null, 2));
    await settle();
    expect(stateOf(album('5'))).toMatchObject({
      phase: 'ready',
      owner: { title: '专辑 5' },
      total: 2,
      cursor: null,
    });
    first();
    second();
    lists.want(album('5'))();
    expect(calls).toHaveLength(1);
  });

  it('没人看的至多留 4 张，从最早放手的丢，丢掉时作废在途的请求', async () => {
    const { calls, lists, stateOf } = setup();
    for (const id of ['1', '2', '3', '4', '5']) lists.want(album(id))();
    expect(stateOf(album('1'))).toBeUndefined();
    expect(calls[0]?.signal?.aborted).toBe(true);
    calls[0]?.answer(page(musicAlbum('1'), ['1'], null, 1));
    await settle();
    expect(stateOf(album('1'))).toBeUndefined();
    expect(stateOf(album('5'))).toMatchObject({ phase: 'loading' });
  });

  it('第一页失败记下原因，重试再取', async () => {
    const { calls, lists, stateOf } = setup();
    lists.want(album('5'));
    calls[0]?.fail('not-found');
    await settle();
    expect(stateOf(album('5'))).toMatchObject({ phase: 'failed', failure: 'not-found' });
    lists.retry(album('5'));
    expect(calls).toHaveLength(2);
    expect(stateOf(album('5'))).toMatchObject({ phase: 'loading', failure: null });
  });

  it('歌单续页接在后面、按身份去重，取到最后一页就停；续页失败可重试', async () => {
    const { calls, lists, stateOf } = setup();
    lists.want(playlist);
    calls[0]?.answer(page(musicPlaylist('9'), ['1', '2'], '2', 4));
    await settle();
    const more = lists.more(playlist);
    expect(stateOf(playlist)).toMatchObject({ loadingMore: true });
    expect(calls[1]?.body).toMatchObject({ cursor: '2' });
    calls[1]?.fail('timeout');
    await more;
    expect(stateOf(playlist)).toMatchObject({ loadingMore: false, moreFailed: true });
    lists.retry(playlist);
    calls[2]?.answer(page(musicPlaylist('9'), ['2', '3', '4'], null, 4));
    await settle();
    expect(stateOf(playlist)?.items.map((track) => track.ref.id)).toEqual(['1', '2', '3', '4']);
    expect(stateOf(playlist)).toMatchObject({ cursor: null, moreFailed: false });
    await lists.more(playlist);
    expect(calls).toHaveLength(3);
  });

  it('对象菜单要曲目：手上有就直接给，没有取第一页，取不到答 null', async () => {
    const { calls, lists } = setup();
    lists.want(album('5'));
    calls[0]?.answer(page(musicAlbum('5'), ['1'], null, 1));
    await settle();
    expect((await lists.tracks(album('5')))?.map((track) => track.ref.id)).toEqual(['1']);
    expect(calls).toHaveLength(1);
    const pending = lists.tracks(album('6'));
    calls[1]?.answer(page(musicAlbum('6'), ['7', '8'], null, 2));
    expect((await pending)?.map((track) => track.ref.id)).toEqual(['7', '8']);
    const failing = lists.tracks(album('7'));
    calls[2]?.fail('upstream-unavailable');
    expect(await failing).toBeNull();
  });

  it('后端还没连上时没取到的，连上后有页面在看的自己重取；上游失败与没人看的不重取', async () => {
    const { calls, store, port, lists, stateOf } = setup();
    lists.want(album('1'));
    const release = lists.want(album('2'));
    lists.want(album('3'));
    calls[0]?.unreachable();
    calls[1]?.unreachable();
    calls[2]?.fail('upstream-unavailable');
    await settle();
    expect(stateOf(album('1'))).toMatchObject({ phase: 'failed', failure: 'backend-unavailable' });
    expect(stateOf(album('3'))).toMatchObject({ phase: 'failed', failure: 'upstream-unavailable' });
    release();
    store.set(port, 51234);
    await settle();
    expect(calls.map((call) => call.body['ref'])).toEqual([
      { platform: 'wy', id: '1' },
      { platform: 'wy', id: '2' },
      { platform: 'wy', id: '3' },
      { platform: 'wy', id: '1' },
    ]);
    expect(stateOf(album('1'))?.phase).toBe('loading');
  });
});
