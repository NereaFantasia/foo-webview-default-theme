import { expect, test, type Page } from '@playwright/test';
import { openImmersive } from '../fixtures/immersivePage.ts';
import { PLAYING_TRACK } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

test.use({ screenshot: 'off' });

// 预设场景左列曲目信息里的艺人名可点：经对象打开服务进历史，在浏览面板里打开，沉浸视图不退
// 试验页用的是真实的服务与历史，所以这里点的是真去处

const SCENE_KEY = 'default-theme.immersive.scene.v1';

async function openScene(page: Page, track = PLAYING_TRACK) {
  await page.addInitScript((key) => localStorage.setItem(key, 'presets'), SCENE_KEY);
  const immersive = await openImmersive(page, { state: { track } });
  await expect(page.locator('[data-scene="presets"] [data-preset="split"]')).toBeVisible();
  return immersive;
}

const artistIn = (scope: ReturnType<Page['locator']>) =>
  scope.getByRole('button', { name: PLAYING_TRACK.artist, exact: true });

const panel = (page: Page) => page.locator('[data-browser-panel]');

async function back(page: Page) {
  await page.evaluate(() => {
    const harness: unknown = Reflect.get(window, '__immersive');
    const back = typeof harness === 'object' && harness ? Reflect.get(harness, 'back') : null;
    if (typeof back !== 'function') throw new Error('试验页没有挂上 __immersive.back');
    Reflect.apply(back, harness, []);
  });
}

test('点曲目信息里的艺人：在浏览面板里打开那位艺人，沉浸视图不退 @smoke', async ({ page }) => {
  const { errors, view } = await openScene(page);
  await artistIn(view.locator('[data-scene-element="info"]')).click();
  await expect(panel(page).locator('[data-page="artists"]')).toBeVisible();
  await expect(view).toBeVisible();
  await expect(view.locator('[data-scene-element="info"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('点了艺人之后后退：先回到面板的起步页，再后退收起面板，沉浸视图一直在', async ({ page }) => {
  const { errors, view } = await openScene(page);
  await artistIn(view.locator('[data-scene-element="info"]')).click();
  await expect(panel(page).locator('[data-page="artists"]')).toBeVisible();
  await back(page);
  await expect(panel(page).locator('[data-page="albums"]')).toBeVisible();
  await back(page);
  await expect(panel(page)).toHaveCount(0);
  await expect(view).toBeVisible();
  expect(errors).toEqual([]);
});

// 署名放不下：艺人与专辑均分宽度各自截断；艺人几位铺不开就收成整串一个点击目标，放得下再回到每位各自可点

const LONG_ALBUM = '鸣潮 · 原声音乐精选集 第二辑 Wuthering Waves OST Collection';

function credited(artists: string[], album: string) {
  return makeTrack({ artist: artists.join(', '), artists, album, title: 'Feather' });
}

/** 艺人、专辑两项各自的宽与文字区放不放得下，以及艺人是整串一个按钮还是每位一个 */
function readByline(info: ReturnType<Page['locator']>) {
  return info.evaluate((root) => {
    const meta = (root.children[1] as HTMLElement).children[0] as HTMLElement;
    const [artist, album] = [...meta.children].map((item) => {
      const value = item.lastElementChild as HTMLElement;
      return {
        width: item.getBoundingClientRect().width,
        clipped: value.scrollWidth > value.clientWidth + 1,
        menu: value.querySelectorAll('[aria-haspopup="menu"]').length,
        names: value.querySelectorAll('[role="button"]').length,
      };
    });
    return { artist, album };
  });
}

test('艺人与专辑都放不下：均分宽度，艺人收成整串一个点击目标，专辑不被挤没', async ({ page }) => {
  const long = credited(['苏诗丁', '鸣潮先约电台', '车智妍'], LONG_ALBUM);
  const { errors, view } = await openScene(page, long);
  const info = view.locator('[data-scene-element="info"]');
  await expect.poll(async () => (await readByline(info)).artist.menu).toBe(1);
  const { artist, album } = await readByline(info);
  expect(artist.clipped && album.clipped).toBe(true);
  expect(Math.abs(artist.width - album.width)).toBeLessThanOrEqual(2);
  expect(album.width).toBeGreaterThan(60);
  expect(errors).toEqual([]);
});

test('专辑名短：它保持完整，艺人拿走余下的宽度', async ({ page }) => {
  const { view } = await openScene(
    page,
    credited(['苏诗丁', '鸣潮先约电台特别企划', '车智妍'], 'Tales'),
  );
  const info = view.locator('[data-scene-element="info"]');
  await expect.poll(async () => (await readByline(info)).artist.clipped).toBe(true);
  const { artist, album } = await readByline(info);
  expect(album.clipped).toBe(false);
  expect(artist.width).toBeGreaterThan(album.width);
});

test('窗口窄到放不下收成整串，宽回来又每位各自可点', async ({ page }) => {
  const { errors, view } = await openScene(page, credited(['Nujabes', 'Shing02'], 'Modal Soul'));
  const info = view.locator('[data-scene-element="info"]');
  await expect.poll(async () => (await readByline(info)).artist.names).toBe(2);
  await page.setViewportSize({ width: 700, height: 500 });
  await expect.poll(async () => (await readByline(info)).artist.menu).toBe(1);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(async () => (await readByline(info)).artist.names).toBe(2);
  expect((await readByline(info)).artist.menu).toBe(0);
  expect(errors).toEqual([]);
});
