import type { AlbumInfo, LibraryTrack } from 'foo-webview-sdk';
import type { AnswerTable, HostParams, HostResponse } from './fakeHost.ts';
import { stringParam } from './hostAnswers.ts';
import { albumRow, albumTrackRow } from './libraryRows.ts';

// 专辑页的浏览器测试与单测共用的媒体库：一份专辑清单，按专辑名现答两首曲目。

/** 与宿主一次取全时答的一样：不截断、不带封面。 */
export function albumsAnswer(albums: readonly AlbumInfo[]): HostResponse<'library.getAlbums'> {
  return {
    success: true,
    albums: [...albums],
    total: albums.length,
    offset: 0,
    limit: 100_000,
    hasMore: false,
    includeCover: false,
    fromCache: false,
  };
}

/** 每张专辑两首，折进所问的那一行；路径落在专辑目录下，一眼看得出是哪张的。 */
export function albumTracksAnswer(params: HostParams): HostResponse<'library.getAlbumTracks'> {
  const album = stringParam(params, 'album');
  const albumArtist = stringParam(params, 'albumArtist');
  const tracks: LibraryTrack[] = [1, 2].map((at) =>
    albumTrackRow(album, albumArtist, `${album} ${at}`, { trackNumber: at }),
  );
  return {
    success: true,
    album,
    albumArtist,
    tracks,
    items: tracks,
    total: tracks.length,
  };
}

/**
 * 整库曲目，与 `albumTracksAnswer` 同样每张两首；专辑艺术家照专辑填，曲目折回的专辑键与清单对得上。
 * 列表形态一次取全用它。
 */
export function allTracksAnswer(albums: readonly AlbumInfo[]): HostResponse<'library.getAll'> {
  const tracks: LibraryTrack[] = albums.flatMap((album) =>
    [1, 2].map((at) =>
      albumTrackRow(album.name, album.albumArtist, `${album.name} ${at}`, { trackNumber: at }),
    ),
  );
  return { success: true, tracks, items: tracks, total: tracks.length, offset: 0 };
}

/** 专辑清单、取曲目与整库曲目三项应答，盖在缺省的空库上。 */
export function libraryAnswers(albums: readonly AlbumInfo[]): AnswerTable {
  return {
    library: {
      getAlbums: albumsAnswer(albums),
      getAlbumTracks: albumTracksAnswer,
      getAll: allTracksAnswer(albums),
    },
  };
}

/** 两个流派各几张，名字按字母排开，打字即跳与排序的断言好写。 */
export const SAMPLE_ALBUMS: readonly AlbumInfo[] = [
  ['Abbey Road', 'The Beatles', 'Rock', '1969'],
  ['Blue Train', 'John Coltrane', 'Jazz', '1957'],
  ['Kind of Blue', 'Miles Davis', 'Jazz', '1959'],
  ['Led Zeppelin IV', 'Led Zeppelin', 'Rock', '1971'],
  ['Moanin', 'Art Blakey', 'Jazz', '1958'],
  ['Revolver', 'The Beatles', 'Rock', '1966'],
  ['Somethin Else', 'Cannonball Adderley', 'Jazz', '1958'],
  ['The Wall', 'Pink Floyd', 'Rock', '1979'],
].map(([name = '', artist = '', genre = '', year = '']) => albumRow(name, artist, { genre, year }));

/** 大库：`count` 张，十个流派轮流，用来量滚动的开销。 */
export function manyAlbums(count: number): AlbumInfo[] {
  return Array.from({ length: count }, (_, at) =>
    albumRow(`Album ${String(at).padStart(5, '0')}`, `Artist ${at % 97}`, {
      genre: `Genre ${at % 10}`,
      year: String(1950 + (at % 70)),
    }),
  );
}
