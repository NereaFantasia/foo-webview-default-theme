import { expect, type Locator, type Page } from '@playwright/test';
import type { LibraryTrack } from 'foo-webview-sdk';
import { LIBRARY_VIEW_PLAYLIST } from '../../src/playback/libraryView.ts';
import { albumsAnswer, albumTracksAnswer } from './albumLibrary.ts';
import type { AnswerTable, HostParams } from './fakeHost.ts';
import { hostFailure, numberParam, stringParam } from './hostAnswers.ts';
import { albumRow, albumTrackRow, playlistRow } from './libraryRows.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';

// 歌曲页的 e2e 共用：一个小媒体库，宿主按查询排序的替身只认页面会拼出来的那几种写法（词的 HAS、流派与艺术家的
// IS、无损），从侧边栏进歌曲页。

const ALBUMS = [
  ['Donuts', 'J Dilla', 'Hip-Hop', '2006', ['Workinonit', 'Time: The Donut of the Heart']],
  ['Mezzanine', 'Massive Attack', 'Trip-Hop', '1998', ['Angel', 'Teardrop']],
  ['Modal Soul', 'Nujabes', 'Hip-Hop', '2005', ['Feather', 'Luv (sic) Part 3']],
  ['Dummy', 'Portishead', 'Trip-Hop', '1994', ['Sour Times', 'Glory Box']],
] as const;

export const SONG_ALBUMS = ALBUMS.map(([name, artist, genre, year]) =>
  albumRow(name, artist, { genre, year, trackCount: 2 }),
);

/** 八首；第一首是 MP3，其余是 FLAC。 */
export const SONG_TRACKS: readonly LibraryTrack[] = ALBUMS.flatMap(
  ([album, artist, genre, date, titles], at) =>
    titles.map((title, index) =>
      albumTrackRow(album, artist, title, {
        artist,
        artists: [artist],
        genre,
        date,
        trackNumber: index + 1,
        codec: at === 0 && index === 0 ? 'MP3' : 'FLAC',
        duration: 200 + at * 30 + index,
      }),
    ),
);

function matches(track: LibraryTrack, query: string): boolean {
  if (query === 'ALL') return true;
  const fields = [
    track.title,
    track.artist,
    track.albumArtist,
    track.album,
    track.genre,
    track.date,
  ];
  const words = new Set([...query.matchAll(/HAS "([^"]*)"/g)].map((hit) => hit[1] ?? ''));
  const genres = [...query.matchAll(/genre IS "([^"]*)"/g)].map((hit) => hit[1] ?? '');
  const artists = [...query.matchAll(/artist IS "([^"]*)"/g)].map((hit) => hit[1] ?? '');
  return (
    [...words].every((word) => fields.some((field) => field.toLowerCase().includes(word))) &&
    (genres.length === 0 || genres.includes(track.genre)) &&
    (artists.length === 0 ||
      artists.some((name) => track.artists.includes(name) || track.artist === name)) &&
    (!query.includes('%__encoding% IS lossless') || track.codec === 'FLAC')
  );
}

/** 宿主排好的 handle：只认按标题与按艺术家两种排序串，其余照库序。 */
function sorted(query: string, sort: string): string[] {
  const hits = SONG_TRACKS.filter((track) => matches(track, query));
  const by = sort.startsWith('%title%')
    ? (a: LibraryTrack, b: LibraryTrack) => a.title.localeCompare(b.title)
    : sort.startsWith('%artist%')
      ? (a: LibraryTrack, b: LibraryTrack) =>
          a.artist.localeCompare(b.artist) || a.trackNumber - b.trackNumber
      : () => 0;
  return [...hits].sort(by).map((track) => track.handle);
}

/** 查询里 `%` 不成对就当宿主认不出。 */
const malformed = (query: string) => (query.match(/%/g)?.length ?? 0) % 2 === 1;

/** 查询结果里的一行：起播要路径与子曲目号，表格只用 handle，一并给上。 */
function songRow(handle: string, index: number) {
  const track = SONG_TRACKS.find((row) => row.handle === handle);
  return { index, handle, path: track?.path, subsong: track?.subsong };
}

const pathToHandle = new Map(
  SONG_TRACKS.map((track) => [
    track.subsong > 0 ? `${track.path}|subsong:${track.subsong}` : track.path,
    track.handle,
  ]),
);

function songsAnswers(): AnswerTable {
  // 专用列表此刻的内容（handle），起播前核对行时照它答。
  let filled: string[] = [];
  const view = playlistRow(1, LIBRARY_VIEW_PLAYLIST);
  return {
    library: {
      getAlbums: albumsAnswer(SONG_ALBUMS),
      getAlbumTracks: albumTracksAnswer,
      getAll: {
        success: true,
        tracks: [...SONG_TRACKS],
        items: [...SONG_TRACKS],
        total: SONG_TRACKS.length,
        offset: 0,
      },
      query: (params: HostParams) => {
        const query = stringParam(params, 'query');
        if (malformed(query)) return hostFailure('INVALID_PARAMS', '无效过滤器表达式');
        const handles = sorted(query, stringParam(params, 'sort'));
        return {
          success: true,
          tracks: handles.map(songRow),
          total: handles.length,
        };
      },
      addToPlaylist: (params: HostParams) => {
        const value = params['paths'];
        const paths = Array.isArray(value) ? value.map(String) : [];
        filled = [...filled, ...paths.map((path) => pathToHandle.get(path) ?? path)];
        return { success: true, added: paths.length };
      },
    },
    playlist: {
      getAll: {
        success: true,
        playlists: [playlistRow(0, 'Default', { isActive: true }), view],
        count: 2,
      },
      clear: () => {
        const clearedCount = filled.length;
        filled = [];
        return {
          success: true,
          playlist: 1,
          playlistGuid: view.guid,
          clearedCount,
          remainingCount: 0,
        };
      },
      getTracks: (params: HostParams) => {
        const start = numberParam(params, 'start') ?? 0;
        const count = numberParam(params, 'count') ?? 0;
        const tracks = filled
          .slice(start, start + count)
          .map((handle, at) => ({ index: start + at, handle }));
        return {
          success: true,
          playlist: 1,
          start,
          count: tracks.length,
          total: filled.length,
          tracks,
        };
      },
    },
  };
}

export interface SongsPage {
  readonly host: PageHost;
  readonly errors: string[];
  readonly view: Locator;
  readonly grid: Locator;
  readonly subtitle: Locator;
  /** 过滤框本身（输入框）。 */
  readonly box: Locator;
  /** 标题正是 `title` 的那一行。 */
  row(title: string): Locator;
  /** 表格里各行的标题，按显示顺序。 */
  titles(): Promise<string[]>;
}

/** 装上替身、打开页面，从侧边栏点进歌曲页，等表格画出行。 */
export async function openSongs(
  page: Page,
  options: {
    readonly configure?: (host: PageHost) => void;
    readonly waitForRows?: boolean;
  } = {},
): Promise<SongsPage> {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: songsAnswers() });
  options.configure?.(host);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '侧边栏' });
  await nav.getByRole('button', { name: '歌曲', exact: true }).click();
  const view = page.locator('[data-page="songs"]');
  await expect(view.getByRole('heading', { level: 1, name: '歌曲' })).toBeVisible();
  const grid = view.getByRole('treegrid', { name: '歌曲' });
  // 骨架行的标题格里没有字：等第一行有了标题才算画出来。
  if (options.waitForRows !== false) {
    await expect(grid.locator('[role="gridcell"][data-column-id="title"]').first()).toHaveText(
      /\S/,
    );
  }
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    host,
    errors,
    view,
    grid,
    subtitle: view.locator('[data-songs-subtitle]'),
    box: view.locator('input[data-query-input]'),
    row: (title) => grid.getByRole('row', { name: new RegExp(`(^|\\s)${escaped(title)}(\\s|$)`) }),
    titles: () =>
      grid
        .locator('[role="gridcell"][data-column-id="title"]')
        .evaluateAll((cells) => cells.map((cell) => cell.textContent ?? '')),
  };
}
