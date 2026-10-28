import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';
import { answerLargeQueue, QUEUE_LIST_GUID, queueScroller } from '../fixtures/rightCardPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 预设场景里预设 1「分栏」的几何：封面列与侧栏的位置、封面边长、侧栏收起时的居中、页签与更多菜单里的侧栏开关、
// 当前封面的共享名字只有一个。只量框的位置与大小，观感由用户实机看。

const SCENE_KEY = 'default-theme.immersive.scene.v1';
const ENTRY = "import '/tests/fixtures/immersiveHarnessEntry.ts';";
const LYRICS = '[00:01]第一句\n[00:05]第二句\n[00:09]第三句';

async function openPresets(
  page: Page,
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly lyrics?: boolean;
    /** 宿主支持全屏：视图里出全屏键 */
    readonly fullscreen?: boolean;
  } = {},
): Promise<PlayerPage> {
  await page.addInitScript((key) => localStorage.setItem(key, 'presets'), SCENE_KEY);
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: ENTRY }),
  );
  const player = await openPlayer(page, { width: options.width ?? 1280 });
  if (options.height)
    await page.setViewportSize({ width: options.width ?? 1280, height: options.height });
  player.host.answer(
    'lyrics.get',
    options.lyrics === false
      ? { success: true, available: false, path: '' }
      : {
          success: true,
          available: true,
          source: 'embedded',
          path: '',
          lyrics: LYRICS,
          synced: true,
        },
  );
  if (options.fullscreen) {
    player.host.answer('window.getMode', {
      success: true,
      mode: 'standalone',
      panelMode: false,
      windowId: 'main',
    });
    player.host.answer('window.isFullscreen', {
      success: true,
      fullscreen: false,
      isFullscreen: false,
      windowId: 'main',
    });
  }
  // 启动时那一次读歌词答的是缺省的失败，换一首才会重新读
  const next = makeTrack({ path: 'file://E:/Music/Other/02 Other.flac', title: 'Other' });
  player.state.track = next;
  await player.host.emit('playback:trackChanged', next);
  await page.waitForFunction(() => '__immersive' in window);
  await page.evaluate(() => {
    const harness: unknown = Reflect.get(window, '__immersive');
    const open = typeof harness === 'object' && harness ? Reflect.get(harness, 'open') : null;
    if (typeof open !== 'function') throw new Error('试验页没有挂上 __immersive.open');
    Reflect.apply(open, harness, []);
  });
  await expect(page.locator('[data-scene="presets"] [data-preset="split"]')).toBeVisible();
  // 进视图的过渡带缩放，边框要等它播完才是排版值；播完前量到的是缩放中的框（399.86 对 400 这类）
  await page.evaluate(async () => {
    const view = document.querySelector('[data-scene="presets"]')?.closest('section');
    const playing = view?.getAnimations() ?? [];
    await Promise.all(playing.map((animation) => animation.finished.catch(() => undefined)));
  });
  return player;
}

const element = (page: Page, name: string): Locator =>
  page.locator(`[data-scene-element="${name}"]`);

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('元素没有框');
  return rect;
}

test('1280 × 800 有歌词：封面 400 见方，整组在窗口左缘到窗口正中线之间居中（左边 120），歌词栏在右边 0.55 的栏里，页签在控制层', async ({
  page,
}) => {
  const { errors } = await openPresets(page);
  await expect(element(page, 'lyrics')).toBeVisible();
  const cover = await box(element(page, 'cover'));
  expect(cover.width).toBe(400);
  expect(cover.height).toBe(400);
  // 居中范围是窗口左缘到正中线 640，封面 400 宽，左边 (640 − 400) ÷ 2
  expect(cover.x).toBeCloseTo(120, 0);
  const lyrics = await box(element(page, 'lyrics'));
  expect(lyrics.x).toBeCloseTo(0.45 * 1280, 0);
  expect(lyrics.height).toBeCloseTo(800, 0);
  const names = ['cover', 'info', 'progress', 'transport', 'order', 'volume', 'more'];
  for (const name of names) await expect(element(page, name)).toBeVisible();
  // 页签在顶部居中，在控制层里
  const tabs = await box(element(page, 'tabs'));
  expect(tabs.x + tabs.width / 2).toBeCloseTo(640, -1);
  expect(tabs.y).toBeLessThan(64);
  expect(errors).toStrictEqual([]);
});

test('封面列的件都不超出封面宽，从上到下依次是封面、信息、进度、传输行', async ({ page }) => {
  await openPresets(page);
  const cover = await box(element(page, 'cover'));
  const rows = ['info', 'progress', 'transport'];
  let top = cover.y + cover.height;
  for (const name of rows) {
    const rect = await box(element(page, name));
    expect(rect.x).toBeGreaterThanOrEqual(cover.x - 1);
    expect(rect.x + rect.width).toBeLessThanOrEqual(cover.x + cover.width + 1);
    expect(rect.y).toBeGreaterThanOrEqual(top - 1);
    top = rect.y;
  }
});

test('封面列整组的上沿与高度是算出来的：封面上沿、传输行下沿与队列页的列上下对齐，三种窗高都是整数像素', async ({
  page,
}) => {
  await openPresets(page);
  await page.getByRole('tab', { name: /队列/ }).click();
  const sizes = [
    { width: 1280, height: 800, top: 103, stack: 594 },
    { width: 960, height: 600, top: 65, stack: 471 },
    { width: 800, height: 440, top: 68, stack: 304 },
  ] as const;
  for (const { width, height, top, stack } of sizes) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => (await box(element(page, 'cover'))).y, { message: `${width} × ${height}` })
      .toBe(top);
    // 队列页刚换进来时有上移 20 px 的页内过渡，播完才落在排版值上
    await expect
      .poll(async () => (await box(element(page, 'queue'))).y, {
        message: `${width} × ${height} 队列页的列上沿`,
      })
      .toBe(top);
    const column = await box(element(page, 'queue'));
    const transport = await box(element(page, 'transport'));
    expect(column.height, `${width} × ${height} 队列页的列高`).toBe(stack);
    expect(transport.y + transport.height, `${width} × ${height} 传输行下沿`).toBe(top + stack);
  }
});

test('窗高跨过字号档的界限：曲目信息元素原地换档，不重新挂载', async ({ page }) => {
  await openPresets(page);
  const info = element(page, 'info');
  await expect(info).toHaveAttribute('data-size', 'large');
  await info.evaluate((node) => Reflect.set(node, 'keptAcrossResize', true));
  await page.setViewportSize({ width: 1280, height: 600 });
  await expect(info).toHaveAttribute('data-size', 'medium');
  expect(await info.evaluate((node) => Reflect.get(node, 'keptAcrossResize'))).toBe(true);
  await page.setViewportSize({ width: 1280, height: 440 });
  await expect(info).toHaveAttribute('data-size', 'small');
  expect(await info.evaluate((node) => Reflect.get(node, 'keptAcrossResize'))).toBe(true);
});

/** 打开更多键的菜单，点其中的侧栏开关；菜单里是「展开侧栏」还是「收起侧栏」由此刻是否居中定 */
async function toggleSidebar(page: Page, name: '展开侧栏' | '收起侧栏') {
  await element(page, 'more').getByRole('button').click();
  await page.getByRole('menuitem', { name }).click();
}

test('没有歌词时自动居中：侧栏收起，封面列在整宽里居中，页签仍在，更多菜单里是「展开侧栏」', async ({
  page,
}) => {
  await openPresets(page, { lyrics: false });
  await expect(element(page, 'lyrics')).toHaveCount(0);
  const cover = await box(element(page, 'cover'));
  expect(cover.x + cover.width / 2).toBeCloseTo(640, 0);
  await expect(element(page, 'tabs')).toBeVisible();
  await element(page, 'more').getByRole('button').click();
  await expect(page.getByRole('menuitem', { name: '展开侧栏' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '收起侧栏' })).toHaveCount(0);
});

test('点队列页签：侧栏换成队列页，歌词栏撤掉；更多菜单里点「收起侧栏」：侧栏收起', async ({
  page,
}) => {
  await openPresets(page);
  await page.getByRole('tab', { name: /队列/ }).click();
  await expect(element(page, 'queue')).toBeVisible();
  // 沉浸视图里的滚动区不显示滚动条
  for (const name of ['queue']) {
    const width = await element(page, name).evaluate(
      (node) => getComputedStyle(node).scrollbarWidth,
    );
    expect(width).toBe('none');
  }
  await expect(element(page, 'lyrics')).toHaveCount(0);
  await page.getByRole('tab', { name: /历史/ }).click();
  await expect(element(page, 'history')).toBeVisible();
  expect(
    await element(page, 'history').evaluate((node) => getComputedStyle(node).scrollbarWidth),
  ).toBe('none');
  await toggleSidebar(page, '收起侧栏');
  await expect(element(page, 'history')).toHaveCount(0);
});

test('队列页往上滚后点「定位当前」：滚回前面的曲目整段藏在上方的位置', async ({ page }) => {
  const player = await openPresets(page);
  answerLargeQueue(player.host, 200);
  player.host.answer('playback.getCurrentTrackIndex', {
    success: true,
    found: true,
    playlist: 0,
    playlistGuid: QUEUE_LIST_GUID,
    index: 30,
  });
  // 「接下来」只在播放跟随光标关着时推得出来；启动时读到的是缺省的失败，要靠事件告诉它
  await player.host.waitForListener('playback:followCursorChanged');
  await player.host.emit('playback:followCursorChanged', { enabled: false });
  player.state.track = makeTrack({ path: 'file://E:/Music/queue/30.flac', title: '曲目 30' });
  await player.host.emit('playback:trackChanged', player.state.track);
  await page.getByRole('tab', { name: /队列/ }).click();
  // 前面那一段整段在上方时的滚动位置就是这一段的高；平时藏着，一行也不渲染，只有这一段的高撑着
  const earlierHeight = () =>
    page.evaluate(
      () => document.querySelector<HTMLElement>('[data-queue-earlier]')?.offsetHeight ?? 0,
    );
  const gap = async () => {
    const top = await queueScroller(page).evaluate((box) => box.scrollTop);
    return Math.round(top - (await earlierHeight()));
  };
  await expect.poll(earlierHeight).toBeGreaterThan(0);
  await expect.poll(gap).toBe(0);

  await queueScroller(page).evaluate((box) => {
    box.scrollTop -= 300;
  });
  await expect.poll(gap).toBe(-300);
  await page.getByRole('button', { name: '定位当前' }).click();
  await expect.poll(gap).toBe(0);
  expect(player.errors).toEqual([]);
});

/** 经试验页挂的 `__immersive.back()`、`forward()` 走历史的后退与前进，与鼠标侧键同一条路 */
async function stepHistory(page: Page, direction: 'back' | 'forward') {
  await page.evaluate((name) => {
    const harness: unknown = Reflect.get(window, '__immersive');
    const step = typeof harness === 'object' && harness ? Reflect.get(harness, name) : null;
    if (typeof step !== 'function') throw new Error(`试验页没有挂上 __immersive.${name}`);
    Reflect.apply(step, harness, []);
  }, direction);
}

test('后退离开视图再前进回来：页签与侧栏展开方式回到离开前的样子', async ({ page }) => {
  await openPresets(page);
  await page.getByRole('tab', { name: /队列/ }).click();
  await expect(element(page, 'queue')).toBeVisible();
  await stepHistory(page, 'back');
  await expect(page.locator('[data-scene="presets"]')).toBeHidden();
  await stepHistory(page, 'forward');
  await expect(element(page, 'queue')).toBeVisible();
  await expect(element(page, 'lyrics')).toHaveCount(0);
  await toggleSidebar(page, '收起侧栏');
  await expect(element(page, 'queue')).toHaveCount(0);
  await stepHistory(page, 'back');
  await expect(page.locator('[data-scene="presets"]')).toBeHidden();
  await stepHistory(page, 'forward');
  await expect(element(page, 'tabs')).toBeVisible();
  await expect(element(page, 'queue')).toHaveCount(0);
  await element(page, 'more').getByRole('button').click();
  await expect(page.getByRole('menuitem', { name: '展开侧栏' })).toBeVisible();
});

test('没有歌词时从更多菜单展开侧栏：歌词栏出来，画说明与「搜索在线歌词」；再收起回到居中', async ({
  page,
}) => {
  await openPresets(page, { lyrics: false });
  await expect(element(page, 'lyrics')).toHaveCount(0);
  await toggleSidebar(page, '展开侧栏');
  const column = element(page, 'lyrics');
  await expect(column).toBeVisible();
  await expect(column.getByRole('status')).toBeVisible();
  await expect(column.getByRole('button', { name: '搜索在线歌词' })).toBeVisible();
  await toggleSidebar(page, '收起侧栏');
  await expect(element(page, 'lyrics')).toHaveCount(0);
});

test('960 × 600 封面 294；窗宽不到 700 退居中，页签与菜单里的侧栏开关都不出现', async ({
  page,
}) => {
  await openPresets(page, { width: 960, height: 600 });
  expect((await box(element(page, 'cover'))).width).toBe(294);
  await page.setViewportSize({ width: 640, height: 600 });
  await expect(element(page, 'lyrics')).toHaveCount(0);
  await expect(element(page, 'tabs')).toHaveCount(0);
  await element(page, 'more').getByRole('button').click();
  await expect(page.getByRole('menuitem', { name: /侧栏/ })).toHaveCount(0);
});

test('当前封面的共享名字整页只有一个', async ({ page }) => {
  await openPresets(page);
  const holders = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('*')].filter(
        (node) => getComputedStyle(node).viewTransitionName === 'scene-cover',
      ).length,
  );
  expect(holders).toBe(1);
});

test('控制层的键：全屏键是 44 的正圆，Esc 胶囊也是 44 高，没有被挤扁；键与页签的中线同在 y = 42', async ({
  page,
}) => {
  await openPresets(page, { fullscreen: true });
  const keys = [page.locator('[data-fullscreen]'), page.getByRole('button', { name: '退出沉浸' })];
  for (const key of keys) await expect(key).toBeVisible();
  const [fullscreen, esc] = await Promise.all(keys.map((key) => box(key)));
  expect(fullscreen?.width).toBe(44);
  expect(fullscreen?.height).toBe(44);
  expect(esc?.height).toBe(44);
  const tabs = await box(element(page, 'tabs'));
  for (const rect of [fullscreen, esc, tabs])
    expect((rect?.y ?? 0) + (rect?.height ?? 0) / 2).toBeCloseTo(42, 0);
});

test('视图盖住标题栏时撤掉最大化键的矩形，右上角悬停不弹贴靠布局；退出后补报', async ({ page }) => {
  const player = await openPresets(page);
  const calls = () => player.calls('window.setMaximizeButtonRegion');
  await expect.poll(() => calls().at(-1)).toEqual({});
  const before = calls().length;
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-scene="presets"]')).toHaveCount(0);
  await expect.poll(() => calls().length).toBeGreaterThan(before);
  expect(calls().at(-1)).toHaveProperty('region');
});

test('悬停进度线：线上出竖标、线不变粗，上方弹出那一刻的时间与歌词，移开后收起', async ({
  page,
}) => {
  await openPresets(page);
  const progress = element(page, 'progress');
  const slider = progress.locator('[role="slider"]');
  const marker = progress.locator('[data-seek-preview]');
  const groove = progress.locator('[data-seek-fill]').locator('..');
  const track = await box(slider);
  const thickness = (await box(groove)).height;
  await expect(marker).not.toHaveAttribute('data-visible', 'true');
  // 175 s 的曲目，歌词在 1、5、9 s 起：悬停在 7 s 处是第二句
  const x = track.x + track.width * (7 / 175);
  await page.mouse.move(x, track.y + track.height / 2);
  const popover = page.locator('[data-seek-lyrics]');
  await expect(popover).toContainText('第二句');
  await expect(page.getByRole('tooltip')).toContainText('0:07');
  expect((await box(page.getByRole('tooltip'))).y, '弹在线的上方').toBeLessThan(track.y);
  await expect(marker).toHaveAttribute('data-visible', 'true');
  const tick = await box(marker);
  expect(tick.x + tick.width / 2).toBeCloseTo(x, 0);
  expect((await box(groove)).height, '线不变粗').toBe(thickness);
  await page.mouse.move(track.x + track.width / 2, 10);
  await expect(marker).not.toHaveAttribute('data-visible', 'true');
  await expect(popover).toHaveCount(0);
});

test('键盘在进度线上移动时，滑块的说明指向页面里真有的元素', async ({ page }) => {
  await openPresets(page);
  const slider = element(page, 'progress').locator('[role="slider"]');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  const id = await slider.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
});

test('进度线的命中区只有线上下各 8：时间行不接指针，元素的总高不变', async ({ page }) => {
  await openPresets(page);
  const progress = element(page, 'progress');
  const slider = progress.locator('[role="slider"]');
  const marker = progress.locator('[data-seek-preview]');
  const hit = await box(slider);
  expect(hit.height, '线 6 加上下各 8').toBe(22);
  expect((await box(progress)).height, '含下面的时间行').toBe(44);
  const x = hit.x + hit.width / 2;
  // 命中区的下沿以内还触发；下沿以外（时间行）不触发
  await page.mouse.move(x, hit.y + hit.height - 2);
  await expect(marker).toHaveAttribute('data-visible', 'true');
  await page.mouse.move(x, hit.y + hit.height + 6);
  await expect(marker).not.toHaveAttribute('data-visible', 'true');
});

test('传输键：1280 × 800 是 48 见方、图标 28；960 × 600 仍是 40、图标 24', async ({ page }) => {
  await openPresets(page);
  const play = element(page, 'transport').locator('[data-key="play"]');
  expect((await box(play)).width).toBe(48);
  expect((await box(play)).height).toBe(48);
  expect((await box(play.locator('svg'))).width).toBe(28);
  for (const name of ['order', 'volume']) {
    expect((await box(element(page, name).locator('button'))).width).toBe(48);
  }
  await page.setViewportSize({ width: 960, height: 600 });
  await expect.poll(async () => (await box(play)).width).toBe(40);
  expect((await box(play.locator('svg'))).width).toBe(24);
});

test('曲名放不下时按传送带滚：后面接一份相同的字，停顿后滚一圈回到原点；放得下时只有一份', async ({
  page,
}) => {
  const player = await openPresets(page);
  const change = async (title: string, n: number) => {
    const next = makeTrack({ path: `file://E:/Music/Other/0${n} Long.flac`, title });
    player.state.track = next;
    await player.host.emit('playback:trackChanged', next);
  };
  const clip = element(page, 'info').locator('[data-conveyor]');
  await change(
    'A very long track title that cannot possibly fit in the cover column of the preset',
    3,
  );
  await expect(clip).toHaveCount(1);
  const parts = clip.locator('> span > span');
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(2)).toHaveAttribute('aria-hidden', 'true');
  const rest = await parts.evaluateAll((nodes) => {
    const [lead, , tail] = nodes.map((node) => node.getBoundingClientRect());
    return { origin: lead?.left ?? 0, loop: (tail?.left ?? 0) - (lead?.left ?? 0) };
  });
  // 停顿 3 s 之后才滚
  const inner = clip.locator('> span');
  await expect
    .poll(() => inner.evaluate((node) => node.getAnimations().length), { timeout: 8000 })
    .toBeGreaterThan(0);
  // 跳到滚完前一瞬：第二份正好落在第一份原来的位置
  const end = await inner.evaluate((node) => {
    const animation = node.getAnimations()[0];
    const timing = animation?.effect?.getComputedTiming();
    animation?.pause();
    if (animation && timing) animation.currentTime = Number(timing.duration) - 0.01;
    const tail = node.children[2]?.getBoundingClientRect();
    return { tail: tail?.left ?? 0, duration: Number(timing?.duration) };
  });
  expect(end.tail).toBeCloseTo(rest.origin, 0);
  // 28 号字的速度是 36 × 28 ÷ 13 像素每秒
  expect(end.duration).toBeCloseTo((rest.loop / ((36 * 28) / 13)) * 1000, -2);
  await change('Short', 4);
  await expect(clip).toHaveCount(0);
});

test('收起侧栏：侧栏朝正中线缩着收起，播完再卸；再展开放大回来；侧栏不进视图过渡层', async ({
  page,
}) => {
  await openPresets(page);
  const phased = page.locator('[data-preset="split"] [data-phase]');
  // 挂载时开着的侧栏不算进场
  await expect(phased).toHaveCount(0);
  await toggleSidebar(page, '收起侧栏');
  await expect(phased).toHaveAttribute('data-phase', 'leave');
  const leaving = await phased.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      inert: node.hasAttribute('inert'),
      position: style.position,
      pointerEvents: style.pointerEvents,
      animation: style.animationName,
      duration: style.animationDuration,
      // 缩放原点落在栏宽的 1/11 处，也就是窗口正中线
      origin: Number.parseFloat(style.transformOrigin) / node.getBoundingClientRect().width,
    };
  });
  expect(leaving.inert).toBe(true);
  expect(leaving.position).toBe('absolute');
  expect(leaving.pointerEvents).toBe('none');
  expect(leaving.animation).toContain('side-shrink');
  expect(leaving.animation).toContain('side-fade-out');
  // 位移与缩放 500 ms，淡出 334 ms，两个时长都放慢到五成
  expect(seconds(leaving.duration)).toEqual([0.5, 0.334]);
  expect(leaving.origin).toBeCloseTo(1 / 11, 1);
  // 侧栏是页面里的活元素，过渡层里没有它的名字
  expect(
    await page.evaluate(() =>
      document.getAnimations().some((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect : null;
        return target?.pseudoElement?.includes('scene-side') ?? false;
      }),
    ),
  ).toBe(false);
  // 播完才卸
  await expect(phased).toHaveCount(0, { timeout: 3000 });
  await expect(element(page, 'lyrics')).toHaveCount(0);

  await toggleSidebar(page, '展开侧栏');
  await expect(element(page, 'lyrics')).toBeVisible();
  await expect(phased).toHaveAttribute('data-phase', 'enter');
  const entering = await phased.evaluate((node) => {
    const style = getComputedStyle(node);
    return { animation: style.animationName, duration: style.animationDuration };
  });
  expect(entering.animation).toContain('side-grow');
  expect(seconds(entering.duration)).toEqual([0.5, 0.166]);
});

/** 一串计算出来的动画时长（秒），取到毫秒：`calc(250ms / 0.3)` 算出来不是整毫秒 */
function seconds(durations: string): number[] {
  return durations.split(',').map((value) => Math.round(Number.parseFloat(value) * 1000) / 1000);
}

test('减弱动效：收起的侧栏当帧卸，不留退场', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPresets(page);
  await toggleSidebar(page, '收起侧栏');
  await expect(element(page, 'lyrics')).toHaveCount(0, { timeout: 500 });
  await expect(page.locator('[data-preset="split"] [data-phase]')).toHaveCount(0);
});

test('没有歌词时从队列页签切回歌词：退场的栏里还是队列，缩完才卸', async ({ page }) => {
  await openPresets(page, { lyrics: false });
  const phased = page.locator('[data-preset="split"] [data-phase]');
  await page.locator('[data-sidebar-page="queue"]').click();
  await expect(element(page, 'queue')).toBeVisible();
  await page.locator('[data-sidebar-page="lyrics"]').click();
  await expect(phased).toHaveAttribute('data-phase', 'leave');
  await expect(phased.locator('[data-scene-element="queue"]')).toHaveCount(1);
  await expect(element(page, 'lyrics')).toHaveCount(0);
  await expect(phased).toHaveCount(0, { timeout: 3000 });
});

test('没有歌词、侧栏展开着时收起：退场的栏里说明还在，缩完才卸', async ({ page }) => {
  await openPresets(page, { lyrics: false });
  const phased = page.locator('[data-preset="split"] [data-phase]');
  await toggleSidebar(page, '展开侧栏');
  await expect(element(page, 'lyrics').getByRole('status')).toBeVisible();
  await toggleSidebar(page, '收起侧栏');
  await expect(phased).toHaveAttribute('data-phase', 'leave');
  await expect(phased.getByRole('status')).toBeVisible();
  await expect(phased).toHaveCount(0, { timeout: 3000 });
});

const toolbar = (page: Page): Locator => page.locator('[data-lyrics-toolbar]');
const tool = (page: Page, name: string): Locator => page.locator(`[data-lyrics-tool="${name}"]`);

test('歌词工具条：1280 × 800 时上沿对齐封面上沿（左 624、宽 592、高 72），单个按钮是同款的整高图标键，字号与校正是两格高的块', async ({
  page,
}) => {
  const { errors } = await openPresets(page);
  await expect(toolbar(page)).toBeVisible();
  const rect = await box(toolbar(page));
  const cover = await box(element(page, 'cover'));
  expect(rect.x).toBeCloseTo(0.45 * 1280 + 48, 0);
  expect(rect.width).toBeCloseTo(0.55 * 1280 - 112, 0);
  expect(rect.y).toBeCloseTo(cover.y, 0);
  expect(rect.height).toBeCloseTo(72, 0);
  const search = await box(tool(page, 'search'));
  for (const name of ['translation', 'romanization', 'align', 'settings']) {
    const key = await box(tool(page, name));
    expect(key.width, name).toBe(search.width);
    expect(key.height, name).toBe(search.height);
  }
  await expect(toolbar(page).getByRole('group', { name: '字号 (px)' })).toBeVisible();
  await expect(toolbar(page).getByRole('group', { name: '时间校正' })).toBeVisible();
  expect(errors).toStrictEqual([]);
});

test('歌词工具条：宽档放得下全部键，窗宽 1280 与宽档下限 1251 都没有键被挤出条外，字号块收窄、校正块保持原宽', async ({
  page,
}) => {
  await openPresets(page);
  for (const width of [1280, 1251]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(toolbar(page).locator('[data-form]')).toHaveAttribute('data-form', 'wide');
    await expect
      .poll(async () => {
        const bar = await box(toolbar(page));
        const last = await box(tool(page, 'settings'));
        return Math.round(bar.x + bar.width - (last.x + last.width));
      })
      .toBeGreaterThanOrEqual(0);
    const font = await box(toolbar(page).getByRole('group', { name: '字号 (px)' }));
    const timing = await box(toolbar(page).getByRole('group', { name: '时间校正' }));
    expect(timing.width, String(width)).toBeCloseTo(163, 0);
    expect(font.width, String(width)).toBeGreaterThanOrEqual(100);
    const slider = await box(
      toolbar(page).getByRole('group', { name: '字号 (px)' }).getByRole('slider'),
    );
    expect(slider.width, String(width)).toBeGreaterThanOrEqual(36);
  }
});

test('歌词工具条：对齐键轮换居左、居中、居右，歌词栏跟着变，键名带当前对齐', async ({ page }) => {
  await openPresets(page);
  const align = tool(page, 'align');
  const lyrics = element(page, 'lyrics').locator('[data-lyrics-align]').first();
  await expect(align).toHaveAccessibleName('文字对齐：居左');
  await expect(lyrics).toHaveAttribute('data-lyrics-align', 'left');
  await align.click();
  await expect(align).toHaveAccessibleName('文字对齐：居中');
  await expect(lyrics).toHaveAttribute('data-lyrics-align', 'center');
  await align.click();
  await expect(align).toHaveAccessibleName('文字对齐：居右');
  await expect(lyrics).toHaveAttribute('data-lyrics-align', 'right');
  await align.click();
  await expect(lyrics).toHaveAttribute('data-lyrics-align', 'left');
});

test('歌词工具条：歌词没有译文和音译时两个开关都在，都置灰', async ({ page }) => {
  await openPresets(page);
  for (const name of ['translation', 'romanization'])
    await expect(tool(page, name)).toHaveAttribute('aria-disabled', 'true');
});

test('歌词工具条：字号块两端的 A− 与 A+ 每次 2 px，到 12 或 48 时置灰，滑块与滚轮调的是同一个值', async ({
  page,
}) => {
  await openPresets(page);
  const group = toolbar(page).getByRole('group', { name: '字号 (px)' });
  await expect(group).toContainText('22');
  await group.getByRole('button', { name: '增大字号' }).click();
  await expect(group).toContainText('24');
  await group.getByRole('button', { name: '减小字号' }).click();
  await group.getByRole('button', { name: '减小字号' }).click();
  await expect(group).toContainText('20');
  await group.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  await expect(group).toContainText('22');
  // 往上滚加、往下减，一格 2 px
  const rect = await box(group);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(group).toContainText('24');
  await page.mouse.wheel(0, 100);
  await expect(group).toContainText('22');
});

test('歌词工具条：校正块的步进与恢复键', async ({ page }) => {
  await openPresets(page);
  const group = toolbar(page).getByRole('group', { name: '时间校正' });
  await expect(group).toContainText('0 s');
  await group.getByRole('button', { name: '延后 0.5 秒' }).click();
  await expect(group).toContainText('+0.5 s');
  await group.getByRole('button', { name: '提前 0.1 秒' }).click();
  await expect(group).toContainText('+0.4 s');
  await group.getByRole('button', { name: '恢复原时间' }).click();
  await expect(group).toContainText('0 s');
});

test('歌词工具条：搜索展开成输入框，第一次 Esc 只收起搜索，第二次才离开视图', async ({ page }) => {
  await openPresets(page);
  await tool(page, 'search').click();
  const query = toolbar(page).getByRole('textbox', { name: '搜索关键词' });
  await expect(query).toBeFocused();
  await expect(page.locator('[data-lyrics-toolbar-results]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(query).toHaveCount(0);
  await expect(page.locator('[data-scene="presets"]')).toBeVisible();
  await expect(tool(page, 'search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-scene="presets"]')).toHaveCount(0);
});

test('歌词工具条：窗宽 700 时条宽 273，字号与校正收成图标键，点开是小面板，Esc 先收面板', async ({
  page,
}) => {
  await openPresets(page, { width: 700, height: 600 });
  await expect(toolbar(page).getByRole('group', { name: '字号 (px)' })).toHaveCount(0);
  await expect(tool(page, 'font')).toBeVisible();
  await expect(tool(page, 'timing')).toBeVisible();
  await tool(page, 'font').click();
  const panel = page.getByRole('dialog', { name: '字号 (px)' });
  await expect(panel.getByRole('slider')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-scene="presets"]')).toBeVisible();
});

test('歌词工具条：歌词设置键离开沉浸视图', async ({ page }) => {
  await openPresets(page);
  await tool(page, 'settings').click();
  await expect(page.locator('[data-scene="presets"]')).toHaveCount(0);
});

test('歌词工具条：收起成单个图标，再展开；收起后键都不可达', async ({ page }) => {
  await openPresets(page);
  const bar = toolbar(page).locator('[data-state]');
  await expect(bar).toHaveAttribute('data-state', 'open');
  await tool(page, 'collapse').click();
  await expect(bar).toHaveAttribute('data-state', 'collapsed');
  await expect.poll(async () => (await box(bar)).width).toBeCloseTo(40, 0);
  await expect.poll(async () => (await box(bar)).height).toBeCloseTo(40, 0);
  await expect(tool(page, 'expand')).toBeFocused();
  await expect(tool(page, 'search')).not.toBeFocused();
  await tool(page, 'expand').click();
  await expect(bar).toHaveAttribute('data-state', 'open');
  await expect.poll(async () => (await box(bar)).width).toBeCloseTo(0.55 * 1280 - 112, 0);
  await expect.poll(async () => (await box(bar)).height).toBeCloseTo(72, 0);
});

test('歌词工具条：存档里是收起的，进视图就是单个图标，点开能展开', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('default-theme.immersive.lyricsToolbarCollapsed.v1', 'on'),
  );
  await openPresets(page);
  const bar = toolbar(page).locator('[data-state]');
  await expect(bar).toHaveAttribute('data-state', 'collapsed');
  await expect.poll(async () => (await box(bar)).width).toBeCloseTo(40, 0);
  await tool(page, 'expand').click();
  await expect(bar).toHaveAttribute('data-state', 'open');
});
