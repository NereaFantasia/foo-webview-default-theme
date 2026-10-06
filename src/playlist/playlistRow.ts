import type { PlaylistTrackPartial, Track } from 'foo-webview-sdk';

/**
 * 播放列表页每行投影的字段：表格、分组头（专辑艺术家、日期）、页内过滤（流派、日期）与行菜单的「筛选」
 * （一首有几位艺术家时逐位列出，要拆开的 `artists`）要的并集。
 */
export const ROW_FIELDS = [
  'handle',
  'path',
  'absolutePath',
  'subsong',
  'title',
  'artist',
  'artists',
  'album',
  'albumArtist',
  'albumArtists',
  'genre',
  'date',
  'trackNumber',
  'discNumber',
  'duration',
  'rating',
] as const satisfies readonly (keyof Track)[];

export type PlaylistRow = Pick<Track, (typeof ROW_FIELDS)[number]>;

/** 投影过的行在类型上每一项都可缺；请求了的字段宿主一定带，缺省值只用来收窄类型。 */
export function playlistRowOf(track: PlaylistTrackPartial): PlaylistRow {
  return {
    handle: track.handle ?? '',
    path: track.path ?? '',
    absolutePath: track.absolutePath ?? '',
    subsong: track.subsong ?? 0,
    title: track.title ?? '',
    artist: track.artist ?? '',
    artists: track.artists ?? [],
    album: track.album ?? '',
    albumArtist: track.albumArtist ?? '',
    albumArtists: track.albumArtists ?? [],
    genre: track.genre ?? '',
    date: track.date ?? '',
    trackNumber: track.trackNumber ?? 0,
    discNumber: track.discNumber ?? 0,
    duration: track.duration ?? 0,
    rating: track.rating ?? 0,
  };
}
