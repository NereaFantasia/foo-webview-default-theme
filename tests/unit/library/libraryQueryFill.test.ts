import { describe, expect, it, vi } from 'vitest';
import { installFakeQueue, queueTracks } from '../../fixtures/fakeQueue.ts';
import {
  createQueryAutoplaylist,
  playByQuery,
  sendQueryToNew,
  type QueryFill,
} from '../../../src/library/libraryQueryFill.ts';
import { TRACK_LIMIT } from '../../../src/library/libraryTracks.ts';
import { LIBRARY_VIEW_PLAYLIST, PLAY_LIMIT } from '../../../src/playback/libraryView.ts';
import { hostFailure, numberParam } from '../../fixtures/hostAnswers.ts';
import { playlistRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const VIEW = playlistRow(3, LIBRARY_VIEW_PLAYLIST, { trackCount: 12 });
const FILL: QueryFill = { query: 'genre IS "Jazz"', sort: '%title%', descending: false };

interface Song {
  readonly handle: string;
  readonly path: string;
  readonly subsong: number;
}

const song = (name: string, subsong = 0): Song => ({
  handle: subsong ? `E:\\${name}|subsong:${subsong}` : `E:\\${name}`,
  path: `file://E:/${name}`,
  subsong,
});
const pathOf = (track: Song) =>
  track.subsong ? `${track.path}|subsong:${track.subsong}` : track.path;

/**
 * 专用列表在第 3 位；`library.query` 按 `songs` 的顺序答，`library.addToPlaylist` 把加进来的路径记成专用列表的
 * 内容，`getTracks` 照它答 handle。
 */
function hostWith(songs: readonly Song[] = ['a', 'b', 'c'].map((name) => song(name))) {
  const host = installFakeHost();
  const byPath = new Map(songs.map((track) => [pathOf(track), track.handle]));
  let content: string[] = [];
  host.answer('playlist.getAll', { success: true, playlists: [VIEW], count: 1 });
  host.answer('library.query', { success: true, total: songs.length, tracks: [...songs] });
  host.answer('playlist.clear', () => {
    content = [];
    return {
      success: true,
      playlist: 3,
      playlistGuid: VIEW.guid,
      clearedCount: 0,
      remainingCount: 0,
    };
  });
  host.answer('library.addToPlaylist', (params) => {
    const paths = (params['paths'] as string[] | undefined) ?? [];
    content = [...content, ...paths];
    return { success: true, added: paths.length };
  });
  host.answer('playlist.getTracks', (params) => {
    const start = numberParam(params, 'start') ?? 0;
    const count = numberParam(params, 'count') ?? 0;
    const tracks = content
      .slice(start, start + count)
      .map((path, at) => ({ index: start + at, handle: byPath.get(path) ?? path }));
    return {
      success: true,
      playlist: 3,
      start,
      count: tracks.length,
      total: content.length,
      tracks,
    };
  });
  return { host, content: () => content };
}

const methods = (host: ReturnType<typeof installFakeHost>) =>
  host.calls.map((call) => call.method).filter((method) => method !== 'playlist.getTracks');

const many = (count: number) => Array.from({ length: count }, (_, at) => song(`t${at}`));

describe('按查询起播：要回路径，整份换进专用列表', () => {
  it('按页面的查询与排序要路径，清空、加入、核对那一行、起播，都按 GUID；不再转自动列表', async () => {
    const { host, content } = hostWith();
    expect(await playByQuery(host.fb, FILL, { row: 1, handle: 'E:\\b' })).toBe(true);
    expect(methods(host)).toEqual([
      'library.query',
      'playlist.getAll',
      'playlist.clear',
      'library.addToPlaylist',
      'queue.getCount',
      'playlist.playTrack',
    ]);
    expect(host.callsTo('library.query')).toEqual([
      {
        query: FILL.query,
        sort: FILL.sort,
        limit: TRACK_LIMIT,
        fields: ['handle', 'path', 'subsong'],
      },
    ]);
    expect(content()).toEqual(['file://E:/a', 'file://E:/b', 'file://E:/c']);
    expect(host.callsTo('library.addToPlaylist')[0]).toMatchObject({ playlistGuid: VIEW.guid });
    expect(host.callsTo('playlist.playTrack')).toEqual([{ playlistGuid: VIEW.guid, index: 1 }]);
    expect(host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  });

  it('有手动队列时起播保留队列', async () => {
    const { host } = hostWith();
    const queue = installFakeQueue(host, queueTracks('queued'));
    expect(await playByQuery(host.fb, FILL, { row: 1, handle: 'E:\\b' })).toBe(true);
    expect(queue.titles()).toEqual(['queued']);
    expect(host.callsTo('queue.insertNext')).toEqual([
      { items: [{ playlist: 3, item: 1 }], position: 0 },
    ]);
  });

  it('分轨的路径带上子曲目号', async () => {
    const { host, content } = hostWith([song('cue', 1), song('cue', 2), song('plain')]);
    expect(await playByQuery(host.fb, FILL, { row: 1, handle: 'E:\\cue|subsong:2' })).toBe(true);
    expect(content()).toEqual([
      'file://E:/cue|subsong:1',
      'file://E:/cue|subsong:2',
      'file://E:/plain',
    ]);
    expect(host.callsTo('playlist.playTrack')).toEqual([{ playlistGuid: VIEW.guid, index: 1 }]);
  });

  it('降序：整份反过来再对行', async () => {
    const { host, content } = hostWith();
    expect(
      await playByQuery(host.fb, { ...FILL, descending: true }, { row: 0, handle: 'E:\\c' }),
    ).toBe(true);
    expect(content()).toEqual(['file://E:/c', 'file://E:/b', 'file://E:/a']);
    expect(host.callsTo('playlist.playTrack')).toEqual([{ playlistGuid: VIEW.guid, index: 0 }]);
  });

  it('那一行对不上时在整份里按 handle 找；库里已经没有它就不播', async () => {
    const { host } = hostWith(many(500));
    expect(await playByQuery(host.fb, FILL, { row: 10, handle: 'E:\\t480' })).toBe(true);
    expect(host.callsTo('playlist.playTrack')).toEqual([{ playlistGuid: VIEW.guid, index: 480 }]);
    const gone = hostWith(many(5));
    expect(await playByQuery(gone.host.fb, FILL, { row: 1, handle: 'E:\\missing' })).toBe(false);
    expect(gone.host.callsTo('playlist.clear')).toEqual([]);
  });

  it(`超过 ${PLAY_LIMIT} 首时只交一段：点中的那一首在中间，靠近两头时贴着那一头`, async () => {
    const total = PLAY_LIMIT + 2000;
    const middle = hostWith(many(total));
    expect(await playByQuery(middle.host.fb, FILL, { row: 6000, handle: 'E:\\t6000' })).toBe(true);
    expect(middle.content()).toHaveLength(PLAY_LIMIT);
    expect(middle.content()[0]).toBe(`file://E:/t${6000 - PLAY_LIMIT / 2}`);
    expect(middle.host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: VIEW.guid, index: PLAY_LIMIT / 2 },
    ]);

    const head = hostWith(many(total));
    expect(await playByQuery(head.host.fb, FILL, { row: 3, handle: 'E:\\t3' })).toBe(true);
    expect(head.content()[0]).toBe('file://E:/t0');
    expect(head.host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: VIEW.guid, index: 3 },
    ]);

    const tail = hostWith(many(total));
    const last = total - 1;
    expect(await playByQuery(tail.host.fb, FILL, { row: last, handle: `E:\\t${last}` })).toBe(true);
    expect(tail.content().at(-1)).toBe(`file://E:/t${last}`);
    expect(tail.host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: VIEW.guid, index: PLAY_LIMIT - 1 },
    ]);
  });

  it(`随机：整份打乱后从第一首起；超过 ${PLAY_LIMIT} 首时随机取这么多首`, async () => {
    const small = hostWith(many(50));
    expect(await playByQuery(small.host.fb, FILL, 'shuffle')).toBe(true);
    expect([...small.content()].sort()).toEqual(many(50).map(pathOf).sort());
    expect(small.host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: VIEW.guid, index: 0 },
    ]);
    expect(small.host.callsTo('playlist.shuffle')).toEqual([]);

    const big = hostWith(many(PLAY_LIMIT + 500));
    expect(await playByQuery(big.host.fb, FILL, 'shuffle')).toBe(true);
    expect(big.content()).toHaveLength(PLAY_LIMIT);
    expect(new Set(big.content()).size).toBe(PLAY_LIMIT);
  });

  it('任一步失败即停，不起播：要路径失败、加进去的条数对不上', async () => {
    const failed = hostWith();
    failed.host.answer('library.query', hostFailure('OPERATION_FAILED'));
    expect(await playByQuery(failed.host.fb, FILL, { row: 0, handle: 'E:\\a' })).toBe(false);
    expect(failed.host.callsTo('playlist.clear')).toEqual([]);

    const short = hostWith();
    short.host.answer('library.addToPlaylist', { success: true, added: 2 });
    expect(await playByQuery(short.host.fb, FILL, { row: 0, handle: 'E:\\a' })).toBe(false);
    expect(short.host.callsTo('playlist.playTrack')).toEqual([]);
  });

  it('等宿主答复期间取消，不继续起播', async () => {
    const { host } = hostWith();
    let active = true;
    const held = host.hold('queue.getCount');
    const pending = playByQuery(host.fb, FILL, { row: 1, handle: 'E:\\b' }, () => active);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    active = false;
    held.release();
    expect(await pending).toBe(false);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
  });
});

describe('按查询发送与建自动列表', () => {
  it(`发送到新列表：新建之后整份加进去，超过 ${PLAY_LIMIT} 首也不截`, async () => {
    const { host } = hostWith(many(PLAY_LIMIT + 10));
    expect(await sendQueryToNew(host.fb, '歌曲', FILL)).toBe(true);
    expect(host.callsTo('playlist.create')).toEqual([{ name: '歌曲' }]);
    const [added] = host.callsTo('library.addToPlaylist');
    expect(added).toMatchObject({ playlistGuid: '{00000000-0000-0000-0000-000000000001}' });
    expect((added?.['paths'] as unknown[]).length).toBe(PLAY_LIMIT + 10);
    expect(host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  });

  it('建自动列表：带查询与排序，建成后切为活动列表', async () => {
    const { host } = hostWith();
    host.answer('playlist.createAutoplaylist', {
      success: true,
      index: 5,
      playlist: 5,
      guid: '{5}',
      name: '歌曲',
      query: FILL.query,
    });
    expect(await createQueryAutoplaylist(host.fb, '歌曲', FILL)).toBe(true);
    expect(host.callsTo('playlist.createAutoplaylist')).toEqual([
      { name: '歌曲', query: FILL.query, sort: FILL.sort, keepSorted: false },
    ]);
    expect(host.callsTo('playlist.setActive')).toEqual([{ playlistGuid: '{5}' }]);
  });
});
