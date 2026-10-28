import { describe, expect, it } from 'vitest';
import {
  EMPTY_ONLINE_FILTER,
  filterOnlineTracks,
  onlineConditionCount,
  onlineFacetOptions,
  toggleOnlineFacet,
  toggleOnlinePreset,
} from '../../../../../src/library/search/online/onlineTrackFilter.ts';
import type { MusicTrack } from '../../../../../src/server/musicObjects.ts';
import { musicTrack } from '../../../../fixtures/music.ts';

const artist = (name: string) => ({ ref: null, name });

const TRACKS: readonly MusicTrack[] = [
  musicTrack('1', {
    title: 'Aruarian Dance',
    artists: [artist('Nujabes')],
    album: { ref: null, title: 'Samurai Champloo' },
    qualities: ['128k', '320k', 'flac'],
  }),
  musicTrack('2', {
    title: 'Luv(sic) Pt3',
    subtitle: 'feat. Shing02',
    artists: [artist('Nujabes'), artist('Shing02')],
    album: { ref: null, title: 'Modal Soul' },
    qualities: ['128k', '320k', 'flac', 'flac24bit'],
  }),
  musicTrack('3', {
    title: 'Feather',
    artists: [artist('Cise Starr')],
    album: null,
    qualities: ['128k'],
    access: 'vip',
  }),
];

const playable = (track: MusicTrack) => track.access !== 'vip';
const ids = (tracks: readonly MusicTrack[]) => tracks.map((track) => track.ref.id);

describe('在线曲目的字段与筛选', () => {
  it('任意字段且没有条件时原样交回，不新建数组', () => {
    expect(filterOnlineTracks(TRACKS, 'nujabes', 'any', EMPTY_ONLINE_FILTER, playable)).toBe(
      TRACKS,
    );
  });

  it('选了字段时，那个字段要含查询词的每一个词，大小写不论', () => {
    const run = (text: string, scope: 'title' | 'artist' | 'album') =>
      ids(filterOnlineTracks(TRACKS, text, scope, EMPTY_ONLINE_FILTER, playable));
    expect(run('ARUARIAN dance', 'title')).toEqual(['1']);
    expect(run('luv shing02', 'title')).toEqual(['2']);
    expect(run('nujabes', 'artist')).toEqual(['1', '2']);
    expect(run('shing02', 'artist')).toEqual(['2']);
    expect(run('modal', 'album')).toEqual(['2']);
    expect(run('', 'album')).toEqual(['1', '2', '3']);
  });

  it('预设：能播放去掉取不到地址的，无损与高解析看最高一档', () => {
    const run = (...presets: ('playable' | 'lossless' | 'hiRes')[]) =>
      ids(
        filterOnlineTracks(
          TRACKS,
          '',
          'any',
          presets.reduce(toggleOnlinePreset, EMPTY_ONLINE_FILTER),
          playable,
        ),
      );
    expect(run('playable')).toEqual(['1', '2']);
    expect(run('lossless')).toEqual(['1', '2']);
    expect(run('hiRes')).toEqual(['2']);
    expect(run('lossless', 'hiRes')).toEqual(['2']);
  });

  it('分面：同一分面里勾的几项满足其一，分面之间都要满足', () => {
    const artists = toggleOnlineFacet(
      toggleOnlineFacet(EMPTY_ONLINE_FILTER, 'artist', 'Shing02'),
      'artist',
      'Cise Starr',
    );
    expect(ids(filterOnlineTracks(TRACKS, '', 'any', artists, playable))).toEqual(['2', '3']);
    const both = toggleOnlineFacet(artists, 'album', 'Modal Soul');
    expect(ids(filterOnlineTracks(TRACKS, '', 'any', both, playable))).toEqual(['2']);
    expect(onlineConditionCount(both)).toBe(3);
  });

  it('没有专辑的曲目在勾了专辑分面时不留', () => {
    const filter = toggleOnlineFacet(EMPTY_ONLINE_FILTER, 'album', 'Modal Soul');
    expect(ids(filterOnlineTracks(TRACKS, '', 'any', filter, playable))).toEqual(['2']);
  });

  it('再勾一次取消；切换不改动原来的条件', () => {
    const once = toggleOnlinePreset(EMPTY_ONLINE_FILTER, 'lossless');
    expect(onlineConditionCount(once)).toBe(1);
    expect(onlineConditionCount(EMPTY_ONLINE_FILTER)).toBe(0);
    expect(onlineConditionCount(toggleOnlinePreset(once, 'lossless'))).toBe(0);
    const facet = toggleOnlineFacet(EMPTY_ONLINE_FILTER, 'artist', 'Nujabes');
    expect(facet.facets.artist.has('Nujabes')).toBe(true);
    expect(EMPTY_ONLINE_FILTER.facets.artist.size).toBe(0);
  });

  it('分面的取值与首数取自全部曲目：多位署名各算一首，首数多的在前，同数按名字', () => {
    const options = onlineFacetOptions(TRACKS);
    expect(options.artist).toEqual([
      { value: 'Nujabes', count: 2 },
      { value: 'Cise Starr', count: 1 },
      { value: 'Shing02', count: 1 },
    ]);
    expect(options.album).toEqual([
      { value: 'Modal Soul', count: 1 },
      { value: 'Samurai Champloo', count: 1 },
    ]);
    expect(options.quality).toEqual([
      { value: '128k', count: 1 },
      { value: 'flac', count: 1 },
      { value: 'flac24bit', count: 1 },
    ]);
  });
});
