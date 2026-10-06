import { expect, type Page } from '@playwright/test';
import type { LibraryTrack } from 'foo-webview-sdk';
import { LIBRARY_VIEW_PLAYLIST } from '../../src/playback/libraryView.ts';
import { albumsAnswer, albumTracksAnswer } from './albumLibrary.ts';
import type { AnswerTable, HostParams } from './fakeHost.ts';
import { numberParam, stringParam } from './hostAnswers.ts';
import { albumRow, albumTrackRow, playlistRow } from './libraryRows.ts';
import { collectPageErrors, installPageHost } from './pageHost.ts';

const ALBUMS = [
  albumRow('Donuts', 'J Dilla'),
  albumRow('Modal Soul', 'Nujabes'),
  albumRow('Mezzanine', 'Massive Attack'),
];
export const GENRES_TRACKS: readonly LibraryTrack[] = [
  albumTrackRow('Donuts', 'J Dilla', 'Workinonit', {
    genre: 'Hip-Hop',
    trackNumber: 1,
    discNumber: 1,
  }),
  albumTrackRow('Donuts', 'J Dilla', 'Time', { genre: 'Hip-Hop', trackNumber: 1, discNumber: 2 }),
  albumTrackRow('Modal Soul', 'Nujabes', 'Feather', { genre: 'Hip-Hop', trackNumber: 1 }),
  albumTrackRow('Mezzanine', 'Massive Attack', 'Angel', { genre: 'Trip-Hop', trackNumber: 1 }),
  albumTrackRow('Mezzanine', 'Massive Attack', 'Teardrop', { genre: 'Trip-Hop', trackNumber: 2 }),
  albumTrackRow('', '', 'Untagged'),
  albumTrackRow('Donuts', 'J Dilla', 'Both', {
    genre: 'Hip-Hop, Trip-Hop',
    trackNumber: 2,
    discNumber: 2,
  }),
  albumTrackRow('', '', 'Comma', { genre: 'Rock, Soul' }),
];
const valuesOf = (track: LibraryTrack) =>
  track.title === 'Both' ? ['Hip-Hop', 'Trip-Hop'] : [track.genre];

function hits(params: HostParams): string[] {
  const query = stringParam(params, 'query');
  const names = [...query.matchAll(/genre IS "([^"]*)"/g)].map((match) => match[1]);
  const missing = query.includes('NOT genre PRESENT');
  const words = [...new Set([...query.matchAll(/HAS "([^"]*)"/g)].map((match) => match[1] ?? ''))];
  const tracks = GENRES_TRACKS.filter(
    (track) =>
      ((names.length === 0 && !missing) ||
        names.some((name) => valuesOf(track).includes(name ?? '')) ||
        (missing && track.genre === '')) &&
      words.every((word) =>
        [track.title, track.artist, track.album].some((value) =>
          value.toLowerCase().includes(word),
        ),
      ),
  );
  const sort = stringParam(params, 'sort');
  tracks.sort((a, b) =>
    sort.startsWith('%title%')
      ? a.title.localeCompare(b.title)
      : a.album.localeCompare(b.album) ||
        a.albumArtist.localeCompare(b.albumArtist) ||
        a.discNumber - b.discNumber ||
        a.trackNumber - b.trackNumber,
  );
  return tracks.map((track) => track.handle);
}

const pathToHandle = new Map(
  GENRES_TRACKS.map((track) => [
    track.subsong > 0 ? `${track.path}|subsong:${track.subsong}` : track.path,
    track.handle,
  ]),
);

export function genresAnswers(): AnswerTable {
  // 专用列表此刻的内容（handle），起播前核对行时照它答。
  let filled: string[] = [];
  const view = playlistRow(1, LIBRARY_VIEW_PLAYLIST);
  return {
    library: {
      getAlbums: albumsAnswer(ALBUMS),
      getAlbumTracks: albumTracksAnswer,
      getAll: {
        success: true,
        tracks: [...GENRES_TRACKS],
        items: [...GENRES_TRACKS],
        total: GENRES_TRACKS.length,
        offset: 0,
      },
      query: (params: HostParams) => {
        const all = hits(params);
        return {
          success: true,
          tracks: all.slice(0, numberParam(params, 'limit') ?? all.length).map((handle, index) => {
            const track = GENRES_TRACKS.find((row) => row.handle === handle);
            return { handle, index, path: track?.path, subsong: track?.subsong };
          }),
          total: all.length,
        };
      },
      addToPlaylist: (params: HostParams) => {
        const value = params['paths'];
        const paths = Array.isArray(value) ? value.map(String) : [];
        filled = [...filled, ...paths.map((path) => pathToHandle.get(path) ?? path)];
        return { success: true, added: paths.length };
      },
    },
    titleformat: {
      evalBatch: (params: HostParams) => {
        const value = params['paths'];
        const paths = Array.isArray(value)
          ? value.filter((path): path is string => typeof path === 'string')
          : [];
        return {
          success: true,
          pattern: stringParam(params, 'pattern'),
          total: paths.length,
          successCount: paths.length,
          errorCount: 0,
          results: paths.map((path) => {
            const track = GENRES_TRACKS.find(
              (row) => row.path === path || row.absolutePath === path,
            );
            return {
              path,
              success: true,
              infoAvailable: true,
              result: track ? valuesOf(track).join('\u001f') : '',
            };
          }),
        };
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
        const tracks = filled
          .slice(start, start + (numberParam(params, 'count') ?? 0))
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

export async function openGenres(page: Page) {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: genresAnswers() });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '流派', exact: true })
    .click();
  const view = page.locator('[data-page="genres"]').last();
  await expect(view.getByRole('heading', { level: 2 })).toHaveText('Hip-Hop');
  return {
    host,
    view,
    errors,
    grid: view.getByRole('treegrid'),
    list: view.getByRole('grid', { name: '流派' }),
    genre: (name: string) => view.locator(`[data-genre-name="${name}"]`),
  };
}
