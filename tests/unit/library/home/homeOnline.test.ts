import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  areaOfLocale,
  freshTracks,
  HOME_NEW_TRACK_COUNT,
  orderCharts,
  startHomeOnline,
} from '../../../../src/library/home/homeOnline.ts';
import { showHomeSection } from '../../../../src/library/home/homeSections.ts';
import type { MusicClient } from '../../../../src/playback/musicClient.ts';
import type { MusicStatusRead } from '../../../../src/playback/musicStatus.ts';
import type {
  MusicBanner,
  MusicChart,
  MusicDiscoverRequest,
} from '../../../../src/server/musicDiscover.ts';
import type { MusicStatus } from '../../../../src/server/musicProtocol.ts';
import { musicPlaylist, musicTrack } from '../../../fixtures/music.ts';

const STATUS: MusicStatus = {
  platforms: ['wy'],
  ncm: 'loaded',
  lx: 'unconfigured',
  lxServer: null,
  lxHosted: false,
  account: null,
  unblock: false,
};

/** 第一名到第三名依次是 `ids` 里的曲目 */
const chart = (id: string, ...ids: string[]): MusicChart => ({
  chart: musicPlaylist(id, { kind: 'chart' }),
  region: null,
  updatedAt: 5000,
  entries: ids.map((track, index) => ({
    track: musicTrack(track),
    previous: index + 1,
    since: 1000,
  })),
});

const banner = (id: string): MusicBanner => ({
  label: '新歌首发',
  image: 'https://p1.music.126.net/a.jpg',
  target: { kind: 'track', track: musicTrack(id) },
});

describe('首页在线行的去重', () => {
  it('第一名已在前面的榜里当过第一的榜，排到第一屏之后', () => {
    const charts = [
      chart('hot', 'a', 'b'),
      chart('soar', 'a', 'c'),
      chart('new', 'd'),
      chart('original', 'e'),
      chart('us', 'f'),
    ];
    expect(orderCharts(charts, 3).map((item) => item.chart.ref.id)).toEqual([
      'hot',
      'new',
      'original',
      'soar',
      'us',
    ]);
  });

  it('新歌去掉横幅指向的歌与第一屏榜单露出的几首，最多留一行的数目', () => {
    const tracks = Array.from({ length: 20 }, (_, index) => musicTrack(`t${index}`));
    const fresh = freshTracks(tracks, [banner('t0')], [chart('hot', 't1', 't2')]);
    expect(fresh.map((track) => track.ref.id).slice(0, 2)).toEqual(['t3', 't4']);
    expect(fresh).toHaveLength(HOME_NEW_TRACK_COUNT);
  });

  it('缺省地区按界面语言：中文看华语，日语看日本，韩语看韩国，其余看欧美', () => {
    expect([
      areaOfLocale('zh-CN'),
      areaOfLocale('ja'),
      areaOfLocale('ko'),
      areaOfLocale('en'),
    ]).toEqual(['zh', 'jp', 'kr', 'ea']);
  });
});

function setup(read: MusicStatusRead = { status: 'ready', music: STATUS }) {
  const store = createStore();
  const clock = { now: 0 };
  const status = { state: atom(read), refresh: vi.fn() };
  const pending: { readonly input: MusicDiscoverRequest; resolve(value: unknown): void }[] = [];
  const discover = vi.fn(
    (input: MusicDiscoverRequest) =>
      new Promise<unknown>((resolve) => pending.push({ input, resolve })),
  );
  const client: Pick<MusicClient, 'discover'> = {
    discover: (input) => discover(input) as never,
  };
  const online = startHomeOnline(store, { client, status, now: () => clock.now });
  onTestFinished(() => online.dispose());
  const kinds = () => discover.mock.calls.map(([input]) => JSON.stringify(input));
  /** 答复所有还没答的请求：新歌按地区给一首以地区命名的曲目，其余各类答空；等答复落进状态再返回 */
  const answerAll = async () => {
    for (const { input, resolve } of pending.splice(0))
      resolve(input.kind === 'new-tracks' ? [musicTrack(input.area)] : []);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { store, status, online, clock, discover, kinds, answerAll };
}

describe('首页在线行的取数', () => {
  it('首页挂上时重读在线音乐状态；网易云不可用时不取，状态晚到后再取', async () => {
    const { store, status, online, discover } = setup({ status: 'unknown' });
    online.activate();
    expect(status.refresh).toHaveBeenCalledTimes(1);
    expect(discover).not.toHaveBeenCalled();
    store.set(status.state, { status: 'ready', music: STATUS });
    expect(discover).toHaveBeenCalledTimes(5);
  });

  it('组件没装时不取，并标出组件缺失，供页顶的下载卡用', () => {
    const { store, online, discover } = setup({
      status: 'ready',
      music: { ...STATUS, platforms: [], ncm: 'missing' },
    });
    online.activate();
    expect(discover).not.toHaveBeenCalled();
    expect(store.get(online.missing)).toBe(true);
    expect(store.get(online.available)).toBe(false);
  });

  it('设置里关掉的行不取', () => {
    const { store, online, discover } = setup();
    showHomeSection(store, 'charts', false);
    showHomeSection(store, 'releases', false);
    online.activate();
    expect(discover.mock.calls.map(([input]) => input.kind)).toEqual([
      'banners',
      'new-tracks',
      'playlists',
    ]);
  });

  it('离开不到半小时再回来不重取，过了半小时重取一次', async () => {
    const { online, clock, discover, answerAll } = setup();
    online.activate();
    await answerAll();
    online.activate();
    expect(discover).toHaveBeenCalledTimes(5);
    clock.now += 31 * 60_000;
    online.activate();
    expect(discover).toHaveBeenCalledTimes(10);
  });

  it('换地区时先接着显示原来那一区，新的一区取到后再换过去', async () => {
    const { store, online, kinds, answerAll } = setup();
    online.setTrackArea('ea');
    online.activate();
    await answerAll();
    expect(store.get(online.newTracks)).toMatchObject({
      status: 'ready',
      items: [{ ref: { id: 'ea' } }],
    });
    online.setTrackArea('jp');
    expect(store.get(online.trackArea)).toBe('jp');
    expect(store.get(online.newTracks)).toMatchObject({ items: [{ ref: { id: 'ea' } }] });
    expect(kinds()).toContain(JSON.stringify({ kind: 'new-tracks', area: 'jp' }));
    await answerAll();
    expect(store.get(online.newTracks)).toMatchObject({ items: [{ ref: { id: 'jp' } }] });
  });
});
