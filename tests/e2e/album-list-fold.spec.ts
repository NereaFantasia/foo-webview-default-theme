import { expect, test, type Page } from '@playwright/test';
import { albumsAnswer, libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { albumRow, albumTrackRow } from '../fixtures/libraryRows.ts';
import { installPageHost, collectPageErrors } from '../fixtures/pageHost.ts';

test.use({ screenshot: 'off' });
let errors: string[] = [];
const group = (page: Page, name: string) =>
  page.locator(`[data-table-item-key]:has([data-list-album="${name}"])`);
const ghost = (page: Page) => page.locator('[data-table-fold-ghost]');

async function open(page: Page, height = 2000, dimension = 'genre') {
  errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height });
  const samples = SAMPLE_ALBUMS.map((album) =>
    dimension === 'folder' && album.albumArtist === 'The Beatles'
      ? { ...album, firstTrackPath: `file://E:\\Music\\The Beatles\\${album.name}.flac` }
      : album,
  );
  const answers = libraryAnswers(samples);
  const artists = [...new Set(SAMPLE_ALBUMS.map((album) => album.albumArtist))].map((name) => {
    const albums = SAMPLE_ALBUMS.filter((album) => album.albumArtist === name);
    return {
      name,
      albumCount: albums.length,
      trackCount: albums.length * 2,
      totalDuration: 0,
      albums: albums.map((album) => ({ name: album.name, artist: album.albumArtist })),
    };
  });
  await installPageHost(page, {
    answers: {
      ...answers,
      library: {
        ...answers.library,
        getArtists: { success: true, items: artists, count: artists.length },
        getRoots: {
          success: true,
          enabled: true,
          roots: [
            {
              id: 'E:\\Music',
              absolutePath: 'E:\\Music',
              rawPath: 'E:\\Music',
              displayName: 'Music',
              trackCount: samples.length * 2,
            },
          ],
          total: 1,
          indexedTracks: samples.length * 2,
          skippedTracks: 0,
          fromCache: false,
        },
      },
    },
    config: { 'defaultTheme.browser.form': 'list', 'defaultTheme.browser.dimension': dimension },
  });
  await page.goto('/');
  await expect(group(page, 'Blue Train')).toBeVisible();
}

test.afterEach(() => expect(errors).toEqual([]));

test('单组收起保留不可交互副本，后续专辑从原位补位，播完释放', async ({ page }) => {
  await open(page);
  const before = await group(page, 'Kind of Blue').boundingBox();
  expect(before).not.toBeNull();
  const sample = await group(page, 'Blue Train')
    .getByRole('button', { name: '折叠', exact: true })
    .evaluate(async (button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('缺少开合按钮');
      button.click();
      await new Promise(requestAnimationFrame);
      const frame = document.querySelector<HTMLElement>('[data-table-fold-ghost]');
      if (!frame) throw new Error('没有折叠副本');
      const animations = frame.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = 0;
      }
      const following = frame.children[1]?.firstElementChild;
      return {
        inert: frame.inert,
        hidden: frame.getAttribute('aria-hidden'),
        durations: animations.map((a) => a.effect?.getTiming().duration),
        top: following?.getBoundingClientRect().top,
        pictures: frame.children[0]?.children.length,
      };
    });
  expect(sample.inert).toBe(true);
  expect(sample.hidden).toBe('true');
  expect(sample.durations).toEqual([167, 167]);
  expect(sample.pictures).toBeGreaterThanOrEqual(3);
  expect(sample.top).toBeCloseTo(before?.y ?? 0, 0);
  await expect(group(page, 'Blue Train')).toHaveAttribute('aria-expanded', 'false');
  await ghost(page).evaluate(async (node) => {
    const animations = node.getAnimations({ subtree: true });
    for (const animation of animations) animation.finish();
    await Promise.all(animations.map((a) => a.finished));
  });
  await expect(ghost(page)).toHaveCount(0);
  await expect(group(page, 'Kind of Blue')).toBeVisible();
  expect((await group(page, 'Kind of Blue').boundingBox())?.y).toBeCloseTo(
    (before?.y ?? 0) - 160,
    0,
  );
});

test('快速反向从当前进度继续，封面和曲目恢复且没有遗留副本', async ({ page }) => {
  await open(page);
  await group(page, 'Blue Train').getByRole('button', { name: '折叠', exact: true }).click();
  const reversal = await ghost(page).evaluate(async (frame) => {
    const body = frame.firstElementChild;
    if (!body) throw new Error('没有分组内容');
    for (const animation of frame.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = Number(animation.effect?.getTiming().duration) / 2;
    }
    const before = getComputedStyle(body).translate;
    const button = document.querySelector<HTMLButtonElement>(
      '[data-list-album="Blue Train"] button',
    );
    button?.click();
    await new Promise(requestAnimationFrame);
    const animations = frame.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    const after = getComputedStyle(body).translate;
    const duration = Number(animations[0]?.effect?.getTiming().duration);
    for (const animation of animations) animation.play();
    return { before, after, duration };
  });
  expect(reversal.after).toBe(reversal.before);
  expect(reversal.duration).toBeGreaterThan(0);
  expect(reversal.duration).toBeLessThan(333);
  await expect(ghost(page)).toHaveCount(0);
  await expect(group(page, 'Blue Train').locator('[data-list-cover]')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Blue Train 1' })).toBeVisible();
});

test('末尾分组保住标题位置，滚动时结束动画；减弱动效直接到位', async ({ page }) => {
  await open(page, 720);
  const album = group(page, 'Revolver');
  const table = page.getByRole('treegrid', { name: '专辑列表' });
  await table.focus();
  await page.keyboard.press('End');
  await album.scrollIntoViewIfNeeded();
  const before = await album.boundingBox();
  await album.getByRole('button', { name: '折叠', exact: true }).click();
  await expect(ghost(page)).toHaveCount(1);
  await ghost(page).evaluate((node) => {
    for (const animation of node.getAnimations({ subtree: true })) animation.pause();
  });
  const after = await album.boundingBox();
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  await table.hover();
  await page.mouse.wheel(0, -120);
  await expect(ghost(page)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await album.scrollIntoViewIfNeeded();
  await album.getByRole('button', { name: '展开', exact: true }).click();
  await expect(album).toHaveAttribute('aria-expanded', 'true');
  await expect(ghost(page)).toHaveCount(0);
});

test('长专辑只移动可见范围，滚动和重新载入不会触发折叠动画', async ({ page }) => {
  errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const tracks = Array.from({ length: 400 }, (_, index) =>
    albumTrackRow('Long album', 'Artist', `Long track ${index + 1}`, { trackNumber: index + 1 }),
  );
  await installPageHost(page, {
    config: { 'defaultTheme.browser.form': 'list' },
    answers: {
      library: {
        getAlbums: albumsAnswer([albumRow('Long album', 'Artist', { trackCount: tracks.length })]),
        getAll: { success: true, tracks, items: tracks, total: tracks.length, offset: 0 },
      },
    },
  });
  await page.goto('/');
  const album = group(page, 'Long album');
  await expect(page.getByRole('row').filter({ hasText: 'Long track 1' }).first()).toBeVisible();
  await expect(ghost(page)).toHaveCount(0);
  await album.getByRole('button', { name: '折叠', exact: true }).click();
  const sample = await ghost(page).evaluate((frame) => {
    const animation = frame.children[0]?.getAnimations()[0];
    const effect = animation?.effect;
    const end = effect instanceof KeyframeEffect ? effect.getKeyframes().at(-1)?.['translate'] : '';
    return {
      distance: Math.abs(parseFloat(String(end).split(' ')[1] ?? '0')),
      height: frame.getBoundingClientRect().height,
      rows: frame.children[0]?.children.length ?? 0,
    };
  });
  expect(sample.distance).toBeLessThanOrEqual(sample.height + 1);
  expect(sample.rows).toBeLessThan(40);
  await expect(ghost(page)).toHaveCount(0);
  await page.reload();
  await expect(album).toHaveAttribute('aria-expanded', 'false');
  await expect(ghost(page)).toHaveCount(0);
  await album.getByRole('button', { name: '展开', exact: true }).click();
  await expect(ghost(page)).toHaveCount(0);
  await page.getByRole('treegrid', { name: '专辑列表' }).hover();
  await page.mouse.wheel(0, 2000);
  await expect(ghost(page)).toHaveCount(0);
});

for (const { dimension, section } of [
  { dimension: 'artist', section: 'The Beatles' },
  { dimension: 'albumArtist', section: 'The Beatles' },
  { dimension: 'genre', section: 'Rock' },
  { dimension: 'folder', section: 'E:\\Music\\The Beatles' },
  { dimension: 'libraryRoot', section: 'The Beatles' },
]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${dimension} ${colorScheme} 组头与子专辑一起开合，保留专辑原有折叠状态`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await open(page, 2200, dimension);
      await group(page, 'Revolver').getByRole('button', { name: '折叠', exact: true }).click();
      await expect(ghost(page)).toHaveCount(0);
      const sectionGroup = page.locator('[data-table-item-key]:has([data-list-section])').filter({
        has: page.getByText(section, { exact: true }),
      });
      await sectionGroup.scrollIntoViewIfNeeded();
      const result = await sectionGroup.locator('[data-list-section]').evaluate(async (heading) => {
        if (!(heading instanceof HTMLElement)) throw new Error('缺少分节组头');
        heading.click();
        await new Promise(requestAnimationFrame);
        const frame = document.querySelector<HTMLElement>('[data-table-fold-ghost]');
        if (!frame) throw new Error('分节未播放折叠');
        const result = {
          pictures: frame.children[0]?.children.length ?? 0,
          text: frame.textContent,
          durations: frame
            .getAnimations({ subtree: true })
            .map((animation) => animation.effect?.getTiming().duration),
        };
        for (const animation of frame.getAnimations({ subtree: true })) animation.finish();
        return result;
      });
      expect(result.durations).toEqual([167, 167]);
      expect(result.pictures).toBeGreaterThanOrEqual(4);
      expect(result.text).toContain('Abbey Road 1');
      expect(result.text).toContain('Revolver');
      await expect(sectionGroup).toHaveAttribute('aria-expanded', 'false');
      await expect(group(page, 'Abbey Road')).toHaveCount(0);
      await expect(ghost(page)).toHaveCount(0);
      await page.getByRole('treegrid', { name: '专辑列表' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(sectionGroup).toHaveAttribute('aria-expanded', 'true');
      await expect(ghost(page)).toHaveCount(0);
      await expect(group(page, 'Abbey Road')).toHaveAttribute('aria-expanded', 'true');
      await expect(group(page, 'Revolver')).toHaveAttribute('aria-expanded', 'false');
    });
  }
}
