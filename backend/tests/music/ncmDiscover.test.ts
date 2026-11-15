import { describe, expect, it, vi } from 'vitest';
import { MusicError } from '../../music/musicError.ts';
import { startNcmDiscover, type NcmDiscoverCall } from '../../music/ncmDiscover.ts';

type Name = Parameters<NcmDiscoverCall>[0];
type Answer = (query: Record<string, unknown>) => Record<string, unknown>;

const COVER = 'http://p1.music.126.net/a.jpg';
const song = (id: number) => ({
  id,
  name: `曲目 ${id}`,
  ar: [{ id: 9, name: '艺人' }],
  al: { id: 7, name: '专辑', picUrl: COVER },
  dt: 1000,
  fee: 8,
});
const HOUR = 3_600_000;

/** 按接口名答复的上游，没登记的接口答上游不可用；记下同时在途的调用数 */
function upstream(answers: Partial<Record<Name, Answer>>) {
  let active = 0;
  const state = { most: 0, clock: 0 };
  const call = vi.fn<NcmDiscoverCall>(async (name, query) => {
    active += 1;
    state.most = Math.max(state.most, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const answer = answers[name];
      if (!answer) throw new MusicError('upstream-unavailable');
      return answer(query);
    } finally {
      active -= 1;
    }
  });
  const discover = startNcmDiscover(call, () => state.clock);
  const names = () => call.mock.calls.map(([name]) => name);
  return { call, discover, state, names };
}

const signal = () => new AbortController().signal;

/** 榜单详情：`ranks` 是榜上从第一名起的曲目与上一期名次（从 0 数），`tracks` 是详情带回了哪几首 */
const chartBody = (
  id: number,
  ranks: readonly (readonly [number, number | undefined])[],
  tracks: readonly number[],
) => ({
  code: 200,
  playlist: {
    id,
    name: `榜 ${id}`,
    trackCount: ranks.length,
    updateTime: 5000,
    trackIds: ranks.map(([track, lr]) => ({
      id: track,
      at: track * 100,
      ...(lr === undefined ? {} : { lr }),
    })),
    tracks: tracks.map(song),
  },
  privileges: [],
});

describe('网易云的公共推荐', () => {
  it('横幅只收歌曲与专辑，目标的名字另取；跳网页的与没有版权的歌不出', async () => {
    const { discover, call } = upstream({
      banner: () => ({
        code: 200,
        banners: [
          {
            targetType: 1,
            targetId: 11,
            typeTitle: '新歌首发',
            bigImageUrl: 'http://p1.music.126.net/b1.jpg',
          },
          {
            targetType: 3000,
            targetId: 0,
            typeTitle: '独家策划',
            bigImageUrl: COVER,
            url: 'https://music.163.com',
          },
          {
            targetType: 10,
            targetId: 21,
            typeTitle: '新碟首发',
            imageUrl: 'http://p1.music.126.net/b2.jpg',
          },
          { targetType: 1, targetId: 12, typeTitle: '热歌推荐', bigImageUrl: COVER },
        ],
      }),
      song_detail: () => ({
        code: 200,
        songs: [song(11), song(12)],
        privileges: [{ id: 12, st: -200 }],
      }),
      album: () => ({
        code: 200,
        album: { id: 21, name: '新专辑', type: 'EP', size: 5, artist: { id: 9, name: '艺人' } },
        songs: [],
      }),
    });
    expect(await discover.run({ kind: 'banners' }, signal())).toMatchObject([
      {
        label: '新歌首发',
        image: 'https://p1.music.126.net/b1.jpg',
        target: { kind: 'track', track: { ref: { platform: 'wy', id: '11' }, title: '曲目 11' } },
      },
      {
        label: '新碟首发',
        image: 'https://p1.music.126.net/b2.jpg',
        target: { kind: 'album', album: { ref: { platform: 'wy', id: '21' }, kind: 'ep' } },
      },
    ]);
    expect(call.mock.calls.find(([name]) => name === 'song_detail')?.[1]).toEqual({ ids: '11,12' });
  });

  it('榜单带前三名、上一期的名次与进榜时间，更新说明取自榜单目录；中间一首读不出时停在它前面；取不到的榜不出', async () => {
    const { discover } = upstream({
      toplist_detail: () => ({
        code: 200,
        list: [
          { id: 3778678, name: '热歌榜', updateFrequency: '刚刚更新' },
          { id: 60198, name: '美国Billboard榜', updateFrequency: '每周三更新' },
        ],
      }),
      playlist_detail: ({ id }) => {
        if (id === '3778678')
          return chartBody(
            3778678,
            [
              [1, 0],
              [2, 4],
              [3, undefined],
              [4, 1],
            ],
            [1, 2, 3, 4],
          );
        if (id === '60198')
          return chartBody(
            60198,
            [
              [5, 0],
              [6, 1],
              [7, 2],
            ],
            [5, 7],
          );
        throw new MusicError('not-found');
      },
    });
    const charts = await discover.run({ kind: 'charts' }, signal());
    expect(charts).toMatchObject([
      {
        chart: { ref: { id: '3778678' }, kind: 'chart', updateNote: '刚刚更新' },
        region: null,
        updatedAt: 5000,
        entries: [
          { track: { ref: { id: '1' } }, previous: 1, since: 100 },
          { track: { ref: { id: '2' } }, previous: 5, since: 200 },
          { track: { ref: { id: '3' } }, previous: null, since: 300 },
        ],
      },
      {
        chart: { ref: { id: '60198' }, updateNote: '每周三更新' },
        region: 'us',
        entries: [{ track: { ref: { id: '5' } } }],
      },
    ]);
    expect(charts).toHaveLength(2);
  });

  it('所有榜都取不到时答失败，不当成没有榜', async () => {
    const { discover } = upstream({
      playlist_detail: () => {
        throw new MusicError('rate-limited');
      },
    });
    await expect(discover.run({ kind: 'charts' }, signal())).rejects.toMatchObject({
      code: 'rate-limited',
    });
  });

  it('新歌按地区取并重取详情，去掉没有版权的；新碟按地区代码取；推荐歌单的封面取 picUrl', async () => {
    const { discover, call } = upstream({
      top_song: () => ({ code: 200, data: [{ id: 1 }, { id: 2 }, { id: 2 }, { id: 3 }] }),
      song_detail: () => ({
        code: 200,
        songs: [song(3), song(1), song(2)],
        privileges: [{ id: 3, st: -1 }],
      }),
      album_new: () => ({
        code: 200,
        albums: [
          { id: 5, name: '新碟', artist: { id: 9, name: '艺人' }, picUrl: COVER, publishTime: 0 },
        ],
      }),
      personalized: () => ({
        code: 200,
        result: [
          { id: 8, name: '歌单', picUrl: COVER, playCount: 10, trackCount: 3, copywriter: '' },
        ],
      }),
    });
    const tracks = await discover.run({ kind: 'new-tracks', area: 'ea' }, signal());
    expect(tracks).toMatchObject([{ ref: { id: '1' } }, { ref: { id: '2' } }]);
    expect(tracks).toHaveLength(2);
    expect(await discover.run({ kind: 'new-albums', area: 'jp' }, signal())).toMatchObject([
      { ref: { platform: 'wy', id: '5' }, title: '新碟' },
    ]);
    expect(await discover.run({ kind: 'playlists' }, signal())).toMatchObject([
      {
        ref: { id: '8' },
        cover: 'https://p1.music.126.net/a.jpg',
        kind: 'playlist',
        playCount: 10,
      },
    ]);
    expect(call.mock.calls.map(([name, query]) => [name, query])).toEqual([
      ['top_song', { type: 96 }],
      ['song_detail', { ids: '1,2,3' }],
      ['album_new', { area: 'JP', limit: 30, offset: 0 }],
      ['personalized', { limit: 30 }],
    ]);
  });

  it('上游调用一次只发一个；并发的同类请求共用一次取数', async () => {
    const { discover, state, names } = upstream({
      personalized: () => ({ code: 200, result: [] }),
      album_new: () => ({ code: 200, albums: [] }),
      top_song: () => ({ code: 200, data: [{ id: 1 }] }),
      song_detail: () => ({ code: 200, songs: [song(1)], privileges: [] }),
    });
    await Promise.all([
      discover.run({ kind: 'playlists' }, signal()),
      discover.run({ kind: 'playlists' }, signal()),
      discover.run({ kind: 'new-albums', area: 'all' }, signal()),
      discover.run({ kind: 'new-tracks', area: 'all' }, signal()),
    ]);
    expect(state.most).toBe(1);
    expect(names().filter((name) => name === 'personalized')).toHaveLength(1);
  });

  it('有效期内不再问上游，过期再取；只取到一部分的五分钟后补；失败不留', async () => {
    let banners = 0;
    const { discover, state, names } = upstream({
      personalized: () => ({ code: 200, result: [] }),
      playlist_detail: ({ id }) => {
        if (id === '3778678') return chartBody(3778678, [[1, 0]], [1]);
        throw new MusicError('timeout');
      },
      banner: () => {
        banners += 1;
        if (banners === 1) throw new MusicError('timeout');
        return { code: 200, banners: [] };
      },
    });
    const count = (name: Name) => names().filter((item) => item === name).length;
    await discover.run({ kind: 'playlists' }, signal());
    state.clock += 23 * HOUR;
    await discover.run({ kind: 'playlists' }, signal());
    expect(count('personalized')).toBe(1);
    state.clock += 2 * HOUR;
    await discover.run({ kind: 'playlists' }, signal());
    expect(count('personalized')).toBe(2);

    await discover.run({ kind: 'charts' }, signal());
    const asked = count('playlist_detail');
    state.clock += 4 * 60_000;
    await discover.run({ kind: 'charts' }, signal());
    expect(count('playlist_detail')).toBe(asked);
    state.clock += 2 * 60_000;
    await discover.run({ kind: 'charts' }, signal());
    expect(count('playlist_detail')).toBe(asked * 2);

    await expect(discover.run({ kind: 'banners' }, signal())).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(await discover.run({ kind: 'banners' }, signal())).toEqual([]);
  });

  it('请求方撤销只让它自己返回，取到的结果留给后来的请求', async () => {
    const { discover, names } = upstream({ personalized: () => ({ code: 200, result: [] }) });
    const controller = new AbortController();
    const first = discover.run({ kind: 'playlists' }, controller.signal);
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    expect(await discover.run({ kind: 'playlists' }, signal())).toEqual([]);
    expect(names()).toEqual(['personalized']);
  });
});
