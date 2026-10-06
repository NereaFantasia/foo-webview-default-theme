import { expect, test, type Page } from '@playwright/test';
import { libraryAnswers, manyAlbums } from '../fixtures/albumLibrary.ts';
import type { ConfigValue } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

// 封面墙换列：窗口变宽变窄时图块从旧位置滑到新位置，定位本身第 0 帧就到终值；深处换列时视口锚在
// 顶上那一行。三百张专辑按名字平铺，1280 宽时一行五块、1100 宽时四块。
// 新建的动画可以当场暂停（`holdAnimations`），拿第 0 帧的样子比；滑得顺不顺只能实机看。

const COUNT = 300;
const grid = (page: Page) => page.locator('[data-album-wall]');
const tiles = (page: Page) => page.locator('[data-album-tile]');

let errors: string[] = [];

interface StartOptions {
  readonly reducedMotion?: 'reduce';
  readonly config?: Record<string, ConfigValue>;
  readonly width?: number;
}

async function start(page: Page, options: StartOptions = {}) {
  errors = collectPageErrors(page);
  if (options.reducedMotion) await page.emulateMedia({ reducedMotion: options.reducedMotion });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, timing) {
      const animation = original.call(this, keyframes, timing);
      if (Reflect.get(window, 'holdAnimations') === true) animation.pause();
      return animation;
    };
  });
  await installPageHost(page, {
    answers: libraryAnswers(manyAlbums(COUNT)),
    ...(options.config ? { config: options.config } : {}),
  });
  await page.setViewportSize({ width: options.width ?? 1280, height: 800 });
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();
}

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/**
 * 视口里看得见的图块（`all` 为真时是画出来的全部）：专辑键、此刻画在视口里的位置（含动画）、自己定位用的
 * 列号与上沿。
 */
function visibleTiles(page: Page, all = false) {
  return grid(page).evaluate((element, everything) => {
    const box = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('[data-album-tile]')]
      .map((tile) => {
        const rect = tile.getBoundingClientRect();
        return {
          key: tile.dataset['tileKey'] ?? '',
          left: Math.round(rect.left - box.left),
          top: Math.round(rect.top - box.top),
          bottom: Math.round(rect.bottom - box.top),
          place: `${tile.style.getPropertyValue('--tile-column')}|${tile.style.getPropertyValue('--tile-y')}`,
          column: Number(tile.getAttribute('aria-colindex')),
          moves: tile
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect instanceof KeyframeEffect && animation.effect.composite === 'add',
            )
            .map((animation) => animation.effect?.getTiming().duration),
        };
      })
      .filter((tile) => everything || (tile.bottom > 0 && tile.top < box.height));
  }, all);
}

const columnsOf = (list: readonly { column: number }[]) =>
  Math.max(...list.map((tile) => tile.column));

async function holdAnimations(page: Page) {
  await page.evaluate(() => Reflect.set(window, 'holdAnimations', true));
}

async function finishAnimations(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

test('窗口变窄换列：图块当场定在新位置，叠一段 250 ms 的位移从旧位置滑过去，第 0 帧不跳', async ({
  page,
}) => {
  await start(page);
  const before = await visibleTiles(page);
  expect(columnsOf(before)).toBe(5);
  await holdAnimations(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => columnsOf(await visibleTiles(page))).toBe(4);
  const held = await visibleTiles(page);
  const slid = held.filter((tile) => tile.moves.length > 0);
  expect(slid.length).toBeGreaterThan(5);
  for (const tile of slid) {
    expect(tile.moves).toEqual([250]);
    // 动画停在第 0 帧：看上去还在换列之前的位置。
    const old = before.find((candidate) => candidate.key === tile.key);
    expect(old && { left: old.left, top: old.top }).toEqual({ left: tile.left, top: tile.top });
  }
  await finishAnimations(page);
  const after = await visibleTiles(page, true);
  // 定位在换列那一次提交里就是终值，播完也没变；播完就画在定位的地方。
  for (const tile of slid) {
    const done = after.find((candidate) => candidate.key === tile.key);
    expect(done?.place).toBe(tile.place);
    expect(done?.moves).toEqual([]);
  }
});

test('位移还在播时窗口接着变宽、列数没变：定位当场跟上新宽度，那段位移不重来', async ({ page }) => {
  await start(page);
  await holdAnimations(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => columnsOf(await visibleTiles(page))).toBe(4);
  const held = await visibleTiles(page);
  expect(held.some((tile) => tile.moves.length > 0)).toBe(true);
  await page.setViewportSize({ width: 1140, height: 800 });
  // 位移停在第 0 帧，看得见的位置变了只能是定位跟上了新宽度。
  const last = held.find((tile) => tile.column === 4);
  await expect
    .poll(async () => (await visibleTiles(page)).find((tile) => tile.key === last?.key)?.left)
    .not.toBe(last?.left);
  const later = await visibleTiles(page);
  expect(columnsOf(later)).toBe(4);
  for (const tile of later) {
    const earlier = held.find((candidate) => candidate.key === tile.key);
    if (earlier) expect(tile.moves).toEqual(earlier.moves);
  }
});

test('宽度变了、列数没变：图块自己的属性一个字都不变，位置照样跟上，且与取整后的算式一致', async ({
  page,
}) => {
  await start(page);
  const attributes = () =>
    tiles(page).evaluateAll((list) =>
      list.map((tile) => `${tile.getAttribute('data-tile-key')}|${tile.getAttribute('style')}`),
    );
  const before = await attributes();
  const left = await visibleTiles(page);
  // 这个宽度下间距已封顶、整行居中，起点带半个像素：取整的方向对不对在这里才看得出来。
  await page.setViewportSize({ width: 1311, height: 800 });
  await expect
    .poll(async () => (await visibleTiles(page)).find((tile) => tile.column === 5)?.left)
    .not.toBe(left.find((tile) => tile.column === 5)?.left);
  expect(columnsOf(await visibleTiles(page))).toBe(5);
  expect(await attributes()).toEqual(before);
  // 看得见的横坐标就是起点加列号乘列距再取整，与悬停键、换列位移按的坐标是同一个。
  const { offset, expected } = await grid(page).evaluate((element) => {
    const style = getComputedStyle(element);
    const start = parseFloat(style.getPropertyValue('--row-offset'));
    const pitch = parseFloat(style.getPropertyValue('--tile-pitch'));
    return {
      offset: start,
      expected: [0, 1, 2, 3, 4].map((column) => Math.round(start + column * pitch)),
    };
  });
  expect(offset % 1).toBe(0.5);
  const box = await grid(page).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(element).paddingLeft);
    return rect.left + padding;
  });
  const shown = await tiles(page).evaluateAll((list, origin) => {
    const firstRow = list.filter((tile) => tile.getAttribute('aria-rowindex') === '1');
    return firstRow
      .sort(
        (a, b) => Number(a.getAttribute('aria-colindex')) - Number(b.getAttribute('aria-colindex')),
      )
      .map((tile) => tile.getBoundingClientRect().left - origin);
  }, box);
  expect(shown).toEqual(expected);
  // 悬停键按 `placeVisible` 算的坐标摆，与图块在样式里算出来的落在同一处。
  const target = page.locator('[data-album-tile][aria-rowindex="1"][aria-colindex="3"]');
  await target.hover();
  const keys = page.locator('[data-tile-keys]');
  await expect(keys).toHaveCount(1);
  const [tileLeft, keysLeft] = await Promise.all(
    [target, keys].map((locator) =>
      locator.evaluate((element) => element.getBoundingClientRect().left),
    ),
  );
  expect(keysLeft).toBe(tileLeft);
});

test('深处换列：视口顶上那一行的第一张还在原处，周围的图块滑过去而不是整屏换人', async ({
  page,
}) => {
  await start(page);
  await grid(page).evaluate((element) => {
    element.scrollTop = 6000;
  });
  await expect.poll(async () => (await visibleTiles(page)).length).toBeGreaterThan(10);
  const before = await visibleTiles(page);
  // 压着视口顶边的那一行最左的一块。
  const anchor = [...before].sort((a, b) => a.top - b.top || a.left - b.left)[0];
  expect(anchor?.top).toBeLessThan(0);
  await holdAnimations(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => columnsOf(await visibleTiles(page))).toBe(4);
  const held = await visibleTiles(page);
  const kept = held.filter((tile) => before.some((old) => old.key === tile.key));
  expect(kept.length).toBeGreaterThan(held.length / 2);
  await finishAnimations(page);
  const settled = await visibleTiles(page);
  expect(settled.find((tile) => tile.key === anchor?.key)?.top).toBe(anchor?.top);
});

test('按专辑艺术家分节、每节只有一行时 Shift + 滚轮放大一档换了列：条目数没变，第 0 帧也不跳，视口照样锚定', async ({
  page,
}) => {
  // 1378 宽时内容宽约 1044：边长 160 一行六块，168 一行五块；每节至多三张，换列前后都是节头加一行。
  await start(page, { config: { 'defaultTheme.browser.dimension': 'albumArtist' }, width: 1378 });
  await grid(page).evaluate((element) => {
    element.scrollTop = 3000;
  });
  await expect.poll(async () => (await visibleTiles(page)).length).toBeGreaterThan(5);
  const before = await visibleTiles(page);
  const anchor = [...before].sort((a, b) => a.top - b.top || a.left - b.left)[0];
  await holdAnimations(page);
  await grid(page).evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }),
    );
  });
  await expect
    .poll(async () => (await visibleTiles(page)).some((tile) => tile.moves.length > 0))
    .toBe(true);
  for (const tile of await visibleTiles(page)) {
    const old = before.find((candidate) => candidate.key === tile.key);
    if (old && tile.moves.length > 0) {
      expect({ left: tile.left, top: tile.top }).toEqual({ left: old.left, top: old.top });
    }
  }
  await finishAnimations(page);
  expect((await visibleTiles(page)).find((tile) => tile.key === anchor?.key)?.top).toBe(
    anchor?.top,
  );
});

test('减弱动效：换列直接到位，一块都不滑', async ({ page }) => {
  await start(page, { reducedMotion: 'reduce' });
  // 建出来的动画当场停住，机器慢也数得到。
  await holdAnimations(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => columnsOf(await visibleTiles(page))).toBe(4);
  const moving = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.target instanceof HTMLElement &&
            animation.effect.target.hasAttribute('data-reflow-key'),
        ).length,
  );
  expect(moving).toBe(0);
});
