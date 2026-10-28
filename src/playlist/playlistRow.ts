import type { PlaylistTrackPartial, Track } from 'foo-webview-sdk';

/**
 * 播放列表页使用的曲目字段：表格、分组头（专辑艺术家、日期）、页内过滤（流派、日期）与行菜单的「筛选」
 * （一首有几位艺术家时逐位列出，要拆开的 `artists`）要的并集
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
  'albumId',
  'albumArtist',
  'albumArtists',
  'genre',
  'date',
  'trackNumber',
  'discNumber',
  'duration',
  'rating',
  'codec',
  'bitrate',
  'sampleRate',
  'channels',
  'fileSize',
] as const satisfies readonly (keyof Track)[];

export type PlaylistRow = Pick<Track, (typeof ROW_FIELDS)[number]> &
  Pick<PlaylistTrackPartial, 'added' | 'lastPlayed' | 'playCount'>;

/** 曲目基础字段补为显示用的缺省值；未安装播放统计组件时，统计字段保持缺省 */
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
    ...(track.albumId === undefined ? {} : { albumId: track.albumId }),
    albumArtist: track.albumArtist ?? '',
    albumArtists: track.albumArtists ?? [],
    genre: track.genre ?? '',
    date: track.date ?? '',
    trackNumber: track.trackNumber ?? 0,
    discNumber: track.discNumber ?? 0,
    duration: track.duration ?? 0,
    rating: track.rating ?? 0,
    codec: track.codec ?? '',
    bitrate: track.bitrate ?? 0,
    sampleRate: track.sampleRate ?? 0,
    channels: track.channels ?? 0,
    fileSize: track.fileSize ?? -1,
    added: track.added,
    lastPlayed: track.lastPlayed,
    playCount: track.playCount,
  };
}
