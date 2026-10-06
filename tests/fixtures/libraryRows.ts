import type { AlbumInfo, LibraryTrack, PlaylistInfo } from 'foo-webview-sdk';

// 媒体库的行：按 SDK 声明填全字段，测试只写关心的那几项。宿主声明增删字段时这里编译不过。

/** 一张专辑。`albumArtist` 缺省同 `artist`，与宿主的回落一致；首曲路径由名字拼出。 */
export function albumRow(name: string, artist: string, extra: Partial<AlbumInfo> = {}): AlbumInfo {
  return {
    name,
    artist,
    albumArtist: artist,
    trackCount: 10,
    discCount: 1,
    duration: 2400,
    year: '',
    genre: '',
    label: '',
    firstTrackPath: `file://E:\\Music\\${artist}\\${name}\\01.flac`,
    ...extra,
  };
}

/** 一首媒体库曲目，路径默认落在专辑目录下。 */
export function trackRow(
  album: string,
  title: string,
  extra: Partial<LibraryTrack> = {},
): LibraryTrack {
  const path = extra.path ?? `file://E:\\Music\\${album}\\${title}.flac`;
  const subsong = extra.subsong ?? 0;
  const absolutePath = path.replace(/^file:\/\//, '');
  return {
    index: 0,
    handle: subsong > 0 ? `${absolutePath}|subsong:${subsong}` : absolutePath,
    path,
    absolutePath,
    subsong,
    title,
    artist: 'Artist',
    artists: ['Artist'],
    album,
    albumArtist: extra.albumArtist ?? '',
    albumArtists: extra.albumArtist ? [extra.albumArtist] : [],
    genre: '',
    date: '',
    trackNumber: 0,
    discNumber: 0,
    duration: 180,
    fileSize: 1000,
    bitrate: 900,
    sampleRate: 44100,
    channels: 2,
    codec: 'FLAC',
    rating: 0,
    ...extra,
  };
}

/**
 * 折进「`album` + 专辑艺术家 `albumArtist`」那一行的曲目，照宿主折叠专辑的口径：album artist 标签
 * 就是这个值；它为空时两个艺术家标签都没有。
 */
export function albumTrackRow(
  album: string,
  albumArtist: string,
  title: string,
  extra: Partial<LibraryTrack> = {},
): LibraryTrack {
  const artists = albumArtist ? {} : { artist: '', artists: [] };
  return trackRow(album, title, { albumArtist, ...artists, ...extra });
}

/** 按序号编出的列表 GUID，写法同宿主：花括号、大写十六进制。 */
export function playlistGuid(index: number): string {
  return `{00000000-0000-0000-0000-${index.toString(16).toUpperCase().padStart(12, '0')}}`;
}

/** 一张播放列表。 */
export function playlistRow(index: number, name: string, extra: Partial<PlaylistInfo> = {}) {
  const row: PlaylistInfo = {
    index,
    guid: playlistGuid(index),
    name,
    trackCount: 0,
    isActive: false,
    isPlaying: false,
    isLocked: false,
    isAutoplaylist: false,
    ...extra,
  };
  return row;
}
