import { expect, test, type Page } from '@playwright/test';
import type { LibraryTrack } from 'foo-webview-sdk';
import { albumTracksAnswer, libraryAnswers } from '../fixtures/albumLibrary.ts';
import { stringParam } from '../fixtures/hostAnswers.ts';
import { albumRow, albumTrackRow } from '../fixtures/libraryRows.ts';
import { collectPageErrors, installPageHost, type PageHost } from '../fixtures/pageHost.ts';

// 下拉的版式：面板与封面框同一大小、取同一档图，不随首数变；首数多到露不全时曲目区自己滚动。
// 三张专辑按名字平铺，1280 宽时一行五块：Long 四十首、Short 两首、Twenty 二十首。

const LONG = 40;
const ALBUMS = [
  albumRow('Long', 'Box', { trackCount: LONG }),
  albumRow('Short', 'Single', { trackCount: 2 }),
  albumRow('Twenty', 'Deluxe', { trackCount: 20 }),
];

const tile = (page: Page, name: string) =>
  page.locator('[data-album-tile]').filter({ hasText: name });
const cover = (page: Page) => page.locator('[data-album-dropdown] [data-dropdown-cover]').last();
const list = (page: Page) => page.locator('[data-dropdown-tracks]');

let errors: string[] = [];

async function start(page: Page): Promise<PageHost> {
  errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: libraryAnswers(ALBUMS) });
  host.answer('library.getAlbumTracks', (params) => {
    const album = stringParam(params, 'album');
    const count = ALBUMS.find((row) => row.name === album)?.trackCount ?? 2;
    const albumArtist = stringParam(params, 'albumArtist');
    const tracks: LibraryTrack[] = Array.from({ length: count }, (_, at) =>
      albumTrackRow(album, albumArtist, `${album} ${at + 1}`, { trackNumber: at + 1 }),
    );
    return { ...albumTracksAnswer(params), tracks, items: tracks, total: tracks.length };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(tile(page, 'Long')).toBeVisible();
  return host;
}

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function open(page: Page, name: string, count: number) {
  await tile(page, name).click();
  await expect(list(page).last().locator('[data-dropdown-track]')).toHaveCount(count);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

function panelHeight(page: Page) {
  return page
    .locator('[data-fold-slot]')
    .evaluate((element) =>
      parseFloat(getComputedStyle(element).getPropertyValue('--panel-height')),
    );
}

function boxOf(page: Page) {
  return cover(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
}

test('面板与封面框同一大小，两首、二十首、四十首都一样，封面框铺满面板高；取图的档位也一样', async ({
  page,
}) => {
  const host = await start(page);
  const sizes = [];
  for (const [name, count] of [
    ['Short', 2],
    ['Twenty', 20],
    ['Long', LONG],
  ] as const) {
    await open(page, name, count);
    sizes.push({ panel: await panelHeight(page), cover: await boxOf(page) });
  }
  expect(sizes).toEqual(Array(3).fill({ panel: 340, cover: { width: 340, height: 340 } }));
  // 图块按边长上限 256 取；其余几发是下拉取的。
  const asked = host
    .callsTo('artwork.getFb2kUrlByPath')
    .filter((params) => params['maxSize'] !== 256)
    .map((params) => params['maxSize']);
  expect(new Set(asked)).toEqual(new Set([384]));
});

test('四十首：面板至多露出八行，曲目区自己滚动；一段十六首先排满左栏，下一段接在下面', async ({
  page,
}) => {
  await start(page);
  await open(page, 'Long', LONG);
  expect(await panelHeight(page)).toBe(84 + 8 * 26 + 48);
  const geometry = await list(page).evaluate((element) => {
    const rect = (index: number) =>
      element.querySelectorAll('[data-dropdown-track]')[index]?.getBoundingClientRect();
    const place = (index: number) => {
      const box = rect(index);
      return box && { x: Math.round(box.left), y: Math.round(box.top) };
    };
    return {
      client: element.clientHeight,
      scroll: element.scrollHeight,
      first: place(0),
      ninth: place(8),
      seventeenth: place(16),
    };
  });
  expect(geometry.client).toBe(8 * 26);
  // 前两段各十六首、左右各八行；第三段八首，左右各四行。
  expect(geometry.scroll).toBe(20 * 26);
  expect(geometry.ninth?.y).toBe(geometry.first?.y);
  expect(geometry.ninth?.x).toBeGreaterThan(geometry.first?.x ?? 0);
  expect(geometry.seventeenth).toEqual({
    x: geometry.first?.x,
    y: (geometry.first?.y ?? 0) + 8 * 26,
  });
});

test('四十首：键盘选到露不出来的那首，曲目区滚过去', async ({ page }) => {
  await start(page);
  await open(page, 'Long', LONG);
  await list(page).focus();
  await page.keyboard.press('End');
  const last = list(page).locator('[data-dropdown-track]').last();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  const shown = await list(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const option = element
      .querySelector('[data-dropdown-track]:last-child')
      ?.getBoundingClientRect();
    return {
      scrolled: element.scrollTop > 0,
      inside: !!option && option.top >= box.top - 1 && option.bottom <= box.bottom + 1,
    };
  });
  expect(shown).toEqual({ scrolled: true, inside: true });
});
