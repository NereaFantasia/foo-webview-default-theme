import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import { startBrowserPrefs, wallSortAtom } from '../../../../src/library/albums/browserPrefs.ts';
import { albumBrowseAtom, startAlbumBrowse } from '../../../../src/library/albums/albumBrowse.ts';
import { albumSortOptions } from '../../../../src/library/albums/albumSortOptions.ts';
import { startLibraryTracks } from '../../../../src/library/libraryTracks.ts';
import { libraryAnswers } from '../../../fixtures/albumLibrary.ts';
import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';
import type { ConfigValue } from '../../../fixtures/hostAnswers.ts';

const SORT_KEY = 'defaultTheme.browser.wallSort.v1';
const ALBUMS = [
  albumRow('Old', 'Artist', { year: '1990' }),
  albumRow('New', 'Artist', { year: '2020' }),
  albumRow('Unknown', 'Artist'),
];

async function setup(config: Record<string, ConfigValue> = {}) {
  const host = installFakeHost({ config, answers: libraryAnswers(ALBUMS) });
  const store = createStore();
  const writer = createMemoryConfigWriter(host.fb);
  const prefs = startBrowserPrefs(store, host.fb, writer);
  const browse = startAlbumBrowse(store, host.fb, writer);
  onTestFinished(() => {
    browse.dispose();
    prefs.dispose();
  });
  await Promise.all([prefs.ready, browse.ready]);
  const names = () =>
    store
      .get(albumBrowseAtom)
      .sections.flatMap((section) => section.albums.map((album) => album.name));
  return { host, store, prefs, names };
}

it('旧年份排序保留新在前，独立选择升降序时未知年份仍在最后', async () => {
  const env = await setup({ 'defaultTheme.browser.sort': 'year' });
  expect(env.names()).toEqual(['New', 'Old', 'Unknown']);
  env.prefs.setWallSort({ field: 'year', descending: false });
  expect(env.names()).toEqual(['Old', 'New', 'Unknown']);
  env.prefs.setWallSort({ field: 'year', descending: true });
  expect(env.names()).toEqual(['New', 'Old', 'Unknown']);
  await env.prefs.persistence.settled();
  expect(env.host.config.get('defaultTheme.browser.sort')).toBe('year');
  expect(env.host.config.get(SORT_KEY)).toEqual({ field: 'year', descending: true });
});

it('切换字段取新字段的缺省方向，两种形态的排序存档互不覆盖', async () => {
  const listSort = { field: 'duration', descending: false };
  const env = await setup({
    [SORT_KEY]: { field: 'name', descending: true },
    'defaultTheme.browser.listSort': listSort,
  });
  env.prefs.setWallField('year');
  expect(env.names()).toEqual(['New', 'Old', 'Unknown']);
  env.prefs.setForm('list');
  env.prefs.setForm('wall');
  expect(env.store.get(wallSortAtom).sort).toEqual({ field: 'year', descending: true });
  env.prefs.setWallField('name');
  expect(env.store.get(wallSortAtom).sort).toEqual({ field: 'name', descending: false });
  await env.prefs.persistence.settled();
  expect(env.host.config.get('defaultTheme.browser.listSort')).toEqual(listSort);
});

it('曲目到达后按专辑采样率重排，无需切换排序字段', async () => {
  const env = await setup();
  const tracks = [
    albumTrackRow('Old', 'Artist', 'A', { sampleRate: 192000 }),
    albumTrackRow('New', 'Artist', 'B', { sampleRate: 44100 }),
  ];
  env.host.answer('library.getAll', { success: true, tracks, items: tracks, total: 2, offset: 0 });
  env.prefs.setWallSort({ field: 'sampleRate', descending: true });
  const library = startLibraryTracks(env.store, () => 0, env.host.fb);
  const release = library.want();
  onTestFinished(() => {
    release();
    library.dispose();
  });
  await vi.waitFor(() => expect(env.names()).toEqual(['Old', 'New', 'Unknown']));
});

it('晚到的旧排序不会覆盖用户已经选择的字段和方向', async () => {
  const host = installFakeHost({ config: { [SORT_KEY]: { field: 'year', descending: true } } });
  const held = host.hold('config.get');
  const store = createStore();
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  onTestFinished(() => prefs.dispose());
  await vi.waitFor(() =>
    expect(held.pending.some((params) => params['key'] === SORT_KEY)).toBe(true),
  );
  prefs.setWallSort({ field: 'name', descending: false });
  held.respond(
    held.pending.findIndex((params) => params['key'] === SORT_KEY),
    { success: true, key: SORT_KEY, found: true, value: { field: 'year', descending: true } },
  );
  held.release();
  await prefs.ready;
  expect(store.get(wallSortAtom).sort).toEqual({ field: 'name', descending: false });
});

it('没有播放统计组件时评分仍可选，仅播放统计字段禁用', () => {
  const options = albumSortOptions((key) => key, false).flatMap((group) => group.options);
  expect(options).toHaveLength(16);
  expect(options.find((option) => option.value === 'rating')?.disabled).toBe(false);
  expect(options.filter((option) => option.disabled).map((option) => option.value)).toEqual([
    'added',
    'lastPlayed',
    'firstPlayed',
    'playCount',
  ]);
});
