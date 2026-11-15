import { expect, type Page } from '@playwright/test';
import { HOME_CHANNELS_KEY } from '../../src/library/home/homeChannels.ts';
import { albumsAnswer, albumTracksAnswer, albumsTracks, SAMPLE_ALBUMS } from './albumLibrary.ts';
import { hostFailure, listParam, stringParam, numberParam } from './hostAnswers.ts';
import { collectPageErrors, installPageHost, type PageHost } from './pageHost.ts';
import { wholeLibrary } from './wholeLibrary.ts';
import type { ConfigGetSuccess } from 'foo-webview-sdk';

export async function openHome(
  page: Page,
  options: {
    readonly statistics?: boolean;
    readonly configure?: (host: PageHost) => void;
  } = {},
) {
  const errors = collectPageErrors(page);
  const tracks = albumsTracks(SAMPLE_ALBUMS);
  const host = await installPageHost(page, {
    answers: {
      library: {
        getAlbums: albumsAnswer(SAMPLE_ALBUMS),
        getAlbumTracks: albumTracksAnswer,
        search: wholeLibrary(tracks),
        getRecentlyAdded: {
          success: true,
          tracks: tracks.map((track) => ({ ...track, added: '2025-01-01 00:00:00' })),
          total: tracks.length,
          limit: 300,
          sortBy: options.statistics === false ? 'modified' : 'added',
          fallback: options.statistics === false,
        },
        getStats: {
          success: true,
          totalTracks: tracks.length,
          totalAlbums: SAMPLE_ALBUMS.length,
          totalArtists: new Set(tracks.map((track) => track.artist)).size,
          totalDuration: tracks.reduce((sum, track) => sum + track.duration, 0),
          totalSize: 0,
          cacheValid: true,
          lastModified: 0,
        },
        query: (params) => {
          const query = stringParam(params, 'query');
          if (query === 'invalid%') return hostFailure('INVALID_PARAMS');
          const selected = query === 'NONE' ? [] : tracks;
          return {
            success: true,
            tracks: selected.slice(0, numberParam(params, 'limit') ?? 100_000),
            total: selected.length,
          };
        },
      },
    },
  });
  // 以替身的初值为起点：其中带有「已走完新人引导」的记录，首页的用例不会被引导挡住
  const config = new Map<string, ConfigGetSuccess['value']>(host.config);
  host.answer('config.get', (params) => {
    const key = stringParam(params, 'key');
    return { success: true, key, found: config.has(key), value: config.get(key) ?? null };
  });
  host.answer('config.set', (params) => {
    const key = stringParam(params, 'key');
    const value: ConfigGetSuccess['value'] = JSON.parse(JSON.stringify(params['value'] ?? null));
    config.set(key, value);
    return { success: true, key };
  });
  host.answer('config.getComponents', {
    success: true,
    count: options.statistics === false ? 0 : 1,
    components:
      options.statistics === false
        ? []
        : [{ filename: 'foo_playcount', name: '播放统计信息', version: '3.1.5' }],
  });
  host.answer('playcount.getBatch', (params) => {
    const paths = listParam(params, 'paths');
    return {
      success: true,
      count: paths.length,
      results: paths.map((path) => ({
        path: String(path),
        success: true,
        added: '2025-01-01 00:00:00',
        lastPlayed: '2020-01-01 00:00:00',
        playCount: 1,
        rating: 5,
      })),
    };
  });
  options.configure?.(host);
  await page.goto('/');
  await expect(page.locator('[data-page="albums"]')).toBeVisible();
  const entry = page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '首页', exact: true });
  if (!(await entry.isVisible()))
    await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await entry.click();
  const view = page.locator('[data-page="home"]');
  await expect(view.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
  // 快捷入口在量到行宽后才出，出了说明各行已按宽度排好
  await expect(view.locator('[data-home-section="quick"]')).toBeVisible();
  return { host, view, errors, channels: () => config.get(HOME_CHANNELS_KEY) };
}
