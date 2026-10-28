import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  artistAlbumSearchKeyOf,
  startArtistAlbumSearch,
  type ArtistAlbumQuery,
} from '../../../../src/library/online/artistAlbumSearch.ts';
import { startMusicClient } from '../../../../src/playback/musicClient.ts';
import { BackendRequestError } from '../../../../src/server/backendConnection.ts';
import type { MusicAlbum, MusicRef } from '../../../../src/server/musicObjects.ts';
import { musicAlbum } from '../../../fixtures/music.ts';

interface Call {
  readonly body: Record<string, unknown>;
  readonly signal: AbortSignal | undefined;
  answer(data: unknown): void;
  fail(code: string): void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ARTIST: MusicRef = { platform: 'wy', id: '7' };
const OTHER: MusicRef = { platform: 'wy', id: '9' };
const query = (text: string): ArtistAlbumQuery => ({ artist: ARTIST, name: 'V.A.', text });

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
        });
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
      }),
  });
  const store = createStore();
  const service = startArtistAlbumSearch(store, client);
  onTestFinished(() => {
    service.dispose();
    client.dispose();
  });
  const stateOf = (text: string) =>
    store.get(service.searches).get(artistAlbumSearchKeyOf(query(text)));
  return { calls, service, stateOf };
}

const album = (id: string, lead: MusicRef = ARTIST, ...rest: MusicRef[]): MusicAlbum =>
  musicAlbum(id, {
    artists: [lead, ...rest].map((ref) => ({ ref, name: ref.id === ARTIST.id ? 'V.A.' : '别人' })),
  });
const page = (items: MusicAlbum[], nextCursor: string | null) => ({
  items,
  nextCursor,
  total: null,
  discardedCount: 0,
});

describe('艺人专辑的联网搜索', () => {
  it('搜索词是艺人名加查询词；只留署名里有这位艺人的，不管排第几位', async () => {
    const { calls, service, stateOf } = setup();
    service.want(query('爵士'));
    expect(stateOf('爵士')).toMatchObject({ phase: 'searching' });
    expect(calls[0]?.body).toEqual({
      platform: 'wy',
      kind: 'album',
      query: 'V.A. 爵士',
      cursor: null,
    });
    calls[0]?.answer(page([album('1'), album('2', OTHER), album('3', OTHER, ARTIST)], '20'));
    await settle();
    expect(stateOf('爵士')?.albums.map((item) => item.ref.id)).toEqual(['1', '3']);
    expect(stateOf('爵士')).toMatchObject({ phase: 'ready', cursor: '20' });
  });

  it('一轮连取 3 页后停下，点加载更多再取一页，没有下一页就不再取；各页重复的专辑只留一张', async () => {
    const { calls, service, stateOf } = setup();
    const text = '夏';
    service.want(query(text));
    for (let round = 0; round < 3; round++) {
      expect(calls).toHaveLength(round + 1);
      // 第三页又给了第二页那张
      const id = round === 2 ? '2' : String(round + 1);
      calls[round]?.answer(page([album(id)], String((round + 1) * 20)));
      await settle();
    }
    expect(calls).toHaveLength(3);
    expect(stateOf(text)).toMatchObject({ cursor: '60', loadingMore: false });
    service.more(query(text));
    expect(calls).toHaveLength(4);
    expect(calls[3]?.body).toMatchObject({ cursor: '60' });
    calls[3]?.answer(page([album('4')], null));
    await settle();
    expect(stateOf(text)).toMatchObject({ cursor: null, loadingMore: false });
    expect(stateOf(text)?.albums.map((item) => item.ref.id)).toEqual(['1', '2', '4']);
    service.more(query(text));
    expect(calls).toHaveLength(4);
  });

  it('几处同时要同一个查询只搜一次；没人看了不再往下取，回来接着取', async () => {
    const { calls, service, stateOf } = setup();
    const first = service.want(query('冬'));
    const second = service.want(query('冬'));
    expect(calls).toHaveLength(1);
    calls[0]?.answer(page([album('1')], '20'));
    await settle();
    expect(calls).toHaveLength(2);
    first();
    second();
    calls[1]?.answer(page([album('2')], '40'));
    await settle();
    expect(calls).toHaveLength(2);
    expect(stateOf('冬')).toMatchObject({ cursor: '40', loadingMore: false });
    service.want(query('冬'));
    expect(calls).toHaveLength(3);
    expect(calls[2]?.body).toMatchObject({ cursor: '40' });
  });

  it('第一页失败时记下原因，重试重搜；后面的页失败时保留已搜到的，重试只取一页', async () => {
    const { calls, service, stateOf } = setup();
    service.want(query('春'));
    calls[0]?.fail('rate-limited');
    await settle();
    expect(stateOf('春')).toMatchObject({ phase: 'failed', failure: 'rate-limited' });
    service.retry(query('春'));
    expect(calls).toHaveLength(2);
    calls[1]?.answer(page([album('1')], '20'));
    await settle();
    calls[2]?.fail('timeout');
    await settle();
    expect(stateOf('春')).toMatchObject({ phase: 'ready', moreFailed: true, loadingMore: false });
    expect(stateOf('春')?.albums).toHaveLength(1);
    expect(calls).toHaveLength(3);
    service.retry(query('春'));
    expect(stateOf('春')).toMatchObject({ moreFailed: false });
    expect(calls).toHaveLength(4);
    calls[3]?.answer(page([album('2')], '40'));
    await settle();
    expect(calls).toHaveLength(4);
    expect(stateOf('春')?.albums).toHaveLength(2);
  });

  it('没人看的查询只留 6 个，更早的丢掉并作废在途请求', async () => {
    const { calls, service, stateOf } = setup();
    const texts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const text of texts) {
      const leave = service.want(query(text));
      calls.at(-1)?.answer(page([album(text)], null));
      await settle();
      leave();
    }
    expect(stateOf('a')).toBeUndefined();
    expect(stateOf('b')).toBeDefined();
    expect(stateOf('g')).toBeDefined();
  });
});
