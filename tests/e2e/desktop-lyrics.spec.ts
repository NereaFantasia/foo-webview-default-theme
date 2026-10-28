import { expect, test, type Page } from '@playwright/test';
import {
  DESKTOP_LYRICS_LINES_KEY,
  DESKTOP_LYRICS_VIEW_KEY,
  desktopLyricsViewJson,
  parseDesktopLyricsMessage,
  type DesktopLyricsView,
} from '../../src/lyrics/desktop/desktopLyricsLink.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

test.use({ screenshot: 'off' });

const VIEW: DesktopLyricsView = {
  labels: {
    previous: '上一首',
    play: '播放',
    pause: '暂停',
    next: '下一首',
    earlier: '歌词提前',
    later: '歌词延后',
    align: '切换对齐',
    mode: '切换为单行歌词',
    lock: '锁定',
    unlock: '解锁',
    settings: '设置',
    close: '关闭',
  },
  locked: false,
  align: 'center',
  motionPreset: 'amll',
  mode: 'multi',
  multilineSize: null,
  fontSize: 34,
  sung: '#78d7ce',
  unsung: null,
  tint: null,
  plate: true,
  plateOpacity: 0.7,
  glow: null,
  showTranslation: true,
  showRomanization: false,
  offset: 0,
  title: '窗口尺寸',
  artist: '示例艺人',
  hidden: false,
};

const LINES = {
  id: 'resize',
  lines: [
    {
      words: [{ word: '尺寸变化时仍保留播放器', startTime: 0, endTime: 120_000 }],
      translatedLyric: '尺寸稳定后更新布局',
      romanLyric: '',
      startTime: 0,
      endTime: 120_000,
      isBG: false,
      isDuet: false,
    },
  ],
};

const players = (page: Page) => page.locator('.amll-lyric-player');
const running = (page: Page) => page.locator('.amll-lyric-player[class*="_playing"]');
const windowRoot = (page: Page) => page.locator('[data-align]');

async function dimensions(page: Page) {
  return players(page).evaluateAll((elements) =>
    elements.map((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width: Math.round(width), height: Math.round(height) };
    }),
  );
}

async function openPopup(page: Page, lines = LINES) {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 640, height: 472 });
  await page.addInitScript(() => {
    Object.defineProperties(screen, {
      availLeft: { value: 0 },
      availTop: { value: 0 },
      availWidth: { value: 1920 },
      availHeight: { value: 1080 },
    });
  });
  await page.clock.install();
  const host = await installPageHost(page);
  host.answer('state.get', (params) => ({
    success: true,
    exists: true,
    value:
      params['key'] === DESKTOP_LYRICS_VIEW_KEY
        ? desktopLyricsViewJson(VIEW)
        : params['key'] === DESKTOP_LYRICS_LINES_KEY
          ? lines
          : null,
  }));
  host.answer('playback.getState', {
    success: true,
    state: 'playing',
    canSeek: true,
    canPause: true,
  });
  host.answer('playback.getPosition', () => ({
    success: true,
    position: 2,
    duration: 120,
    path: '',
    subsong: 0,
    hostTime: Date.now(),
  }));
  host.answer('window.getBounds', () => ({ success: true, x: 0, y: 0, ...page.viewportSize()! }));
  host.answer('window.setMinSize', { success: true, windowId: 'popup-1' });
  host.answer('window.setResizable', { success: true, windowId: 'popup-1' });
  host.answer('window.setBounds', async (params) => {
    await page.setViewportSize({
      width: Number(params['width']),
      height: Number(params['height']),
    });
    return { success: true, windowId: 'popup-1' };
  });
  await page.goto('/desktop-lyrics.html?windowId=popup-1');
  await expect(running(page)).toHaveCount(2);
  await expect
    .poll(() => dimensions(page))
    .toEqual([
      { width: 640, height: 384 },
      { width: 640, height: 384 },
    ]);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  return { host, errors };
}

test('连续改尺寸时两层保留旧布局并停帧，稳定后只采用最后的尺寸且不重建播放器', async ({ page }) => {
  const { errors } = await openPopup(page);
  const original = await players(page).elementHandles();
  const before = await dimensions(page);
  await page.setViewportSize({ width: 1000, height: 600 });
  await expect(windowRoot(page)).toHaveAttribute('data-resizing', 'true');
  await expect(running(page)).toHaveCount(0);
  expect(await dimensions(page)).toEqual(before);
  await page.clock.runFor(100);
  await page.setViewportSize({ width: 900, height: 160 });
  await expect(windowRoot(page)).toHaveCSS('width', '900px');
  await page.clock.runFor(100);
  await expect(windowRoot(page)).toHaveAttribute('data-resizing', 'true');
  await expect(windowRoot(page)).not.toHaveAttribute('data-single');
  expect(await dimensions(page)).toEqual(before);
  await page.clock.runFor(60);
  await expect(windowRoot(page)).not.toHaveAttribute('data-resizing');
  await expect(windowRoot(page)).not.toHaveAttribute('data-single');
  await expect(running(page)).toHaveCount(2);
  expect(await dimensions(page)).toEqual([
    { width: 900, height: 72 },
    { width: 900, height: 72 },
  ]);
  for (const element of original)
    expect(await element.evaluate((node) => node.isConnected)).toBe(true);
  expect(errors).toEqual([]);
});

test('预设独立更新两层动效，模式按钮加宽单行并恢复多行尺寸', async ({ page }) => {
  const { host, errors } = await openPopup(page);
  const original = await players(page).elementHandles();
  const spring = page.locator('[data-spring]');
  await expect(spring.first()).toHaveAttribute('data-spring', 'on');
  const view = { ...VIEW, motionPreset: 'winui' as const };
  await host.emit('state:changed', {
    key: DESKTOP_LYRICS_VIEW_KEY,
    previousValue: null,
    sourceWindowId: 'main',
    value: desktopLyricsViewJson(view),
  });
  await expect(spring.first()).toHaveAttribute('data-spring', 'off');
  await expect(spring.last()).toHaveAttribute('data-spring', 'off');
  for (const element of original)
    expect(await element.evaluate((node) => node.isConnected)).toBe(true);
  await page.mouse.move(320, 24);
  await page.clock.runFor(200);
  await page.getByRole('button', { name: '切换为单行歌词' }).click();
  await expect
    .poll(() =>
      host.callsTo('window.sendMessage').map((p) => parseDesktopLyricsMessage(p['message'])),
    )
    .toContainEqual({
      type: 'mode',
      mode: 'single',
      bounds: { x: 0, y: 0, width: 640, height: 472 },
    });
  const multilineSize = { width: 640, height: 472 };
  await host.emit('state:changed', {
    key: DESKTOP_LYRICS_VIEW_KEY,
    previousValue: null,
    sourceWindowId: 'main',
    value: desktopLyricsViewJson({ ...view, mode: 'single', multilineSize }),
  });
  await expect(windowRoot(page)).toHaveAttribute('data-single', 'true');
  await expect.poll(() => page.viewportSize()?.width).toBeGreaterThan(640);
  await page.clock.runFor(300);
  await expect(windowRoot(page)).not.toHaveAttribute('data-interactive');
  await host.emit('state:changed', {
    key: DESKTOP_LYRICS_VIEW_KEY,
    previousValue: null,
    sourceWindowId: 'main',
    value: desktopLyricsViewJson({ ...view, mode: 'multi', multilineSize }),
  });
  await expect.poll(() => page.viewportSize()).toEqual(multilineSize);
  await page.clock.runFor(300);
  await expect(windowRoot(page)).not.toHaveAttribute('data-single');
  await page.setViewportSize({ width: 416, height: 472 });
  await page.mouse.move(208, 24);
  await page.clock.runFor(300);
  expect(host.callsTo('window.setMinSize').at(-1)).toMatchObject({ width: 416 });
  const toolbar = await page.getByRole('toolbar').boundingBox();
  expect(toolbar).not.toBeNull();
  if (toolbar) {
    expect(toolbar.x).toBeGreaterThanOrEqual(8);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(408);
  }
  expect(errors).toEqual([]);
});

test('多行点击跳转、按住歌词拖窗不跳转，单行禁止滚动和跳转', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const lines = {
    id: 'interactions',
    lines: Array.from({ length: 12 }, (_, i) => ({
      words: [{ word: `歌词第${i + 1}行`, startTime: i * 10_000, endTime: (i + 1) * 10_000 }],
      translatedLyric: `译文第${i + 1}行`,
      romanLyric: '',
      startTime: i * 10_000,
      endTime: (i + 1) * 10_000,
      isBG: false,
      isDuet: false,
    })),
  };
  const { host, errors } = await openPopup(page, lines);
  await page.clock.runFor(1000);
  const base = page.locator('[data-layer="base"]');
  const line = base
    .locator('[class*="lyricLine"]:not([class*="Wrapper"])')
    .filter({ hasText: '歌词第1行' })
    .first();
  await line.click();
  const seeks = () =>
    host
      .callsTo('window.sendMessage')
      .map((p) => parseDesktopLyricsMessage(p['message']))
      .filter((c) => c?.type === 'seek');
  await expect.poll(seeks).toEqual([{ type: 'seek', id: 'interactions', seconds: 0 }]);
  const rect = await line.boundingBox();
  if (!rect) throw new Error('缺少歌词行');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => host.callsTo('window.setPosition').at(-1))
    .toMatchObject({ x: 60, y: 30 });
  expect(seeks()).toHaveLength(1);
  const scrollOffsets = () =>
    players(page).evaluateAll((items) =>
      items.map((p) => p.querySelector('[class*="lyricLineWrapper"]')?.getAttribute('style')),
    );
  const before = await scrollOffsets();
  await page.mouse.wheel(0, 160);
  await page.clock.runFor(100);
  await expect.poll(scrollOffsets).not.toEqual(before);
  const offsets = await scrollOffsets();
  expect(offsets[0]).toBe(offsets[1]);
  await host.emit('state:changed', {
    key: DESKTOP_LYRICS_VIEW_KEY,
    previousValue: null,
    sourceWindowId: 'main',
    value: desktopLyricsViewJson({
      ...VIEW,
      mode: 'single',
      multilineSize: { width: 640, height: 472 },
    }),
  });
  await expect(windowRoot(page)).toHaveAttribute('data-single', 'true');
  await expect.poll(() => page.viewportSize()?.height).toBeLessThan(200);
  await page.clock.runFor(400);
  const fixed = await scrollOffsets();
  await page.mouse.move(300, 110);
  await page.mouse.wheel(0, 200);
  await page.mouse.click(300, 110);
  await page.clock.runFor(200);
  expect(await scrollOffsets()).toEqual(fixed);
  expect(seeks()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('改尺寸期间暂停播放，稳定后保持暂停，再播放时恢复两层', async ({ page }) => {
  const { host, errors } = await openPopup(page);
  await page.setViewportSize({ width: 800, height: 500 });
  await expect(windowRoot(page)).toHaveAttribute('data-resizing', 'true');
  const playback = {
    position: 4,
    duration: 120,
    canSeek: true,
    hostTime: await page.evaluate(() => Date.now()),
  };
  await host.emit('playback:stateChanged', { ...playback, state: 'paused' });
  await page.clock.runFor(200);
  await expect(windowRoot(page)).not.toHaveAttribute('data-resizing');
  await expect(running(page)).toHaveCount(0);
  expect(await dimensions(page)).toEqual([
    { width: 800, height: 412 },
    { width: 800, height: 412 },
  ]);
  await host.emit('playback:stateChanged', {
    ...playback,
    hostTime: await page.evaluate(() => Date.now()),
    state: 'playing',
  });
  await expect(running(page)).toHaveCount(2);
  expect(errors).toEqual([]);
});

const LONG_WORDS =
  "I've been walking down this long and winding road for so many years that I forgot where it began".split(
    ' ',
  );
const LONG_LINES = {
  id: 'long',
  lines: [
    {
      words: LONG_WORDS.map((word, index) => ({
        word: index < LONG_WORDS.length - 1 ? `${word} ` : word,
        startTime: index * 1000,
        endTime: index * 1000 + 1000,
      })),
      translatedLyric: '译文很短',
      romanLyric: '',
      startTime: 0,
      endTime: 120_000,
      isBG: false,
      isDuet: false,
    },
    {
      words: [{ word: '(whoa whoa whoa)', startTime: 0, endTime: 120_000 }],
      translatedLyric: '',
      romanLyric: '',
      startTime: 0,
      endTime: 120_000,
      isBG: true,
      isDuet: false,
    },
  ],
};

async function switchToSingle(page: Page, host: Awaited<ReturnType<typeof openPopup>>['host']) {
  await host.emit('state:changed', {
    key: DESKTOP_LYRICS_VIEW_KEY,
    previousValue: null,
    sourceWindowId: 'main',
    value: desktopLyricsViewJson({
      ...VIEW,
      mode: 'single',
      multilineSize: { width: 640, height: 472 },
    }),
  });
  await expect.poll(() => page.viewportSize()?.width).toBeGreaterThan(640);
  await page.clock.runFor(800);
}

test('单行：一句放不下换成两行时窗高多出一行主句，背景行不显示，文字不被裁', async ({ page }) => {
  const { host, errors } = await openPopup(page, LONG_LINES);
  await switchToSingle(page, host);
  // 工具栏 48 + 主句与译文各一行 116 + 多出的一行主句 41
  await expect.poll(() => page.viewportSize()?.height).toBe(48 + 116 + 41);
  await page.clock.runFor(800);
  await expect(page.locator('[class*="bgWrapper"]').first()).toHaveCSS('display', 'none');
  const room = await page.evaluate(() => {
    const layer = document.querySelector('[data-layer="base"]');
    if (!layer) throw new Error('没有下层歌词');
    const area = layer.getBoundingClientRect();
    const main = layer.querySelector('[class*="lyricMainLine"]');
    const sub = layer.querySelector('[class*="lyricSubLine"]');
    if (!main || !sub) throw new Error('没有主句或译文');
    // 逐字的词带 1em 的内边距与反向外边距，框比字大一圈，量字要扣掉
    const words = Array.from(main.children).filter((el) => el.getBoundingClientRect().width > 0);
    const inset = parseFloat(getComputedStyle(words[0]!).paddingTop);
    const rows = new Set(words.map((el) => Math.round(el.getBoundingClientRect().top)));
    const top = Math.min(...words.map((el) => el.getBoundingClientRect().top + inset));
    const bottom = Math.max(
      sub.getBoundingClientRect().bottom,
      ...words.map((el) => el.getBoundingClientRect().bottom - inset),
    );
    return { rows: rows.size, above: top - area.top, below: area.bottom - bottom };
  });
  expect(room.rows).toBe(2);
  // 字的行框比字形大，留 6 像素的容差
  expect(room.above).toBeGreaterThan(-6);
  expect(room.below).toBeGreaterThan(-6);
  expect(errors).toEqual([]);
});

test('单行：每句都放得下一行时窗高不变', async ({ page }) => {
  const { host, errors } = await openPopup(page);
  await switchToSingle(page, host);
  await expect.poll(() => page.viewportSize()?.height).toBe(48 + 116);
  expect(errors).toEqual([]);
});
