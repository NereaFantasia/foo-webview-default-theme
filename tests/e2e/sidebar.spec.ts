import { guidOf } from '../fixtures/fakePlaylists.ts';
import { expect, test, type Page } from '@playwright/test';
import { makePlaylist } from '../fixtures/fakePlaylists.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { clickSideButton, openSidebar } from '../fixtures/sidebarPage.ts';

// 侧边栏的导航：点各项经全局历史切地点，列表点了在宿主里按 GUID 激活；宿主那边改名、删除、切走当前
// 列表时高亮与页面跟着变；分节开合落盘；选中条的动画。动效观感只能实机看。

const albumsItem = (page: Page) =>
  page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '专辑', exact: true });

test('点列表切到它的地点并按 GUID 激活；侧键后退回专辑、前进再激活那张', async ({ page }) => {
  const { host, lists, entry, playlistPage, errors, albumsPage } = await openSidebar(page);
  await expect(albumsItem(page)).toHaveAttribute('aria-current', 'page');

  await entry('Road Trip').click();
  await expect(playlistPage('Road Trip')).toBeVisible();
  await expect(entry('Road Trip')).toHaveAttribute('aria-current', 'page');
  await expect(albumsItem(page)).toHaveAttribute('aria-current', 'false');
  await expect
    .poll(() => host.callsTo('playlist.setActive'))
    .toEqual([{ playlistGuid: lists.guid('Road Trip') }]);

  await clickSideButton(page, 'back');
  await expect(albumsPage).toBeVisible();
  await expect(albumsItem(page)).toHaveAttribute('aria-current', 'page');
  // 离开之后宿主里别处切回了 Default；前进回到 Road Trip 的记录要把它重新激活。
  lists.items = lists.items.map((item) => ({ ...item, isActive: item.name === 'Default' }));
  await host.emit('playlist:activated', { newGuid: guidOf(0), oldIndex: 2, newIndex: 0 });
  expect(lists.activeGuid()).toBe(lists.guid('Default'));
  await clickSideButton(page, 'forward');
  await expect(playlistPage('Road Trip')).toBeVisible();
  await expect.poll(() => lists.activeGuid()).toBe(lists.guid('Road Trip'));
  expect(errors).toEqual([]);
});

test('还没上线的项置灰、强点也不走；行里曲目数常显，正在播放与锁定标在名字前', async ({ page }) => {
  const { nav, entry, errors, albumsPage } = await openSidebar(page);
  for (const name of ['最近添加', '所有播放列表']) {
    const item = nav.getByRole('button', { name, exact: true });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
  }
  // 置灰的项在 Playwright 眼里不可点，强行点一下：点了也不走。
  await nav.getByRole('button', { name: '最近添加', exact: true }).click({ force: true });
  await expect(albumsPage).toBeVisible();

  await expect(entry('Chill').getByLabel('正在播放')).toBeVisible();
  await expect(entry('Chill')).toContainText('12');
  await expect(entry('Road Trip')).toContainText('48');
  // 智能列表的锁位恒为真，不画锁。
  await expect(entry('Smart').getByLabel('已锁定')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('正在看的列表在宿主那边改名、被切走、被删除：页面与高亮跟着变，删了就不亮', async ({
  page,
}) => {
  const { host, lists, entry, playlistPage, errors } = await openSidebar(page);
  await entry('Road Trip').click();
  await expect(playlistPage('Road Trip')).toBeVisible();

  await host.invoke('playlist.rename', { playlistGuid: lists.guid('Road Trip'), name: 'Weekend' });
  await expect(playlistPage('Weekend')).toBeVisible();
  await expect(entry('Weekend')).toHaveAttribute('aria-current', 'page');

  await host.invoke('playlist.setActive', { playlistGuid: lists.guid('Chill') });
  await expect(playlistPage('Chill')).toBeVisible();
  await expect(entry('Chill')).toHaveAttribute('aria-current', 'page');

  const chill = lists.guid('Chill');
  await host.invoke('playlist.remove', { playlistGuid: chill });
  await expect(page.locator(`[data-playlist-entry="${chill}"]`)).toHaveCount(0);
  // 删掉之后宿主那边激活了别的列表，这一条也不改写过去：页面仍是那张已不在的列表，哪一行都不亮。
  await host.invoke('playlist.setActive', { playlistGuid: lists.guid('Default') });
  await expect(page.getByText('此播放列表已删除')).toBeVisible();
  await expect(page.locator('[data-playlist-entry][aria-current="page"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('切换活动列表被宿主拒了：节里出一条提示，可以关掉', async ({ page }) => {
  const { host, entry, nav, errors } = await openSidebar(page);
  host.answer('playlist.setActive', hostFailure('NOT_FOUND'));
  await entry('Road Trip').click();
  const banner = nav.getByText('切换播放列表失败');
  await expect(banner).toBeVisible();
  await nav.getByRole('button', { name: '关闭' }).click();
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('列表多时播放列表节自己滚动：页面不撑出窗口，设置仍钉在底部', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const many = Array.from({ length: 30 }, (_, index) =>
    makePlaylist(index, `List ${String(index).padStart(2, '0')}`, { isActive: index === 0 }),
  );
  const { nav, entry, errors } = await openSidebar(page, many);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(720);
  await expect(nav.getByRole('button', { name: '设置', exact: true })).toBeInViewport();
  await expect(entry('List 29')).not.toBeInViewport();
  expect(errors).toEqual([]);
});

test('分节开合落盘：收起资料库后重新加载仍收着', async ({ page }) => {
  const { nav, errors } = await openSidebar(page);
  const toggle = nav.getByRole('button', { name: '展开或收起「媒体库」' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(albumsItem(page)).toHaveCount(0);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const saved = await page.evaluate(() => localStorage.getItem('default-theme.sidebar.v1'));
  expect(JSON.parse(saved ?? 'null')).toMatchObject({ sections: { library: false } });
  expect(errors).toEqual([]);
});

/**
 * 从现在起，竖条上每新起一段动画就当场暂停、记下来，测试再按 `currentTime` 逐帧摆到位去量，
 * 不依赖机器快慢。
 */
async function holdIndicatorAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const held: Animation[] = [];
    Reflect.set(window, 'heldIndicatorAnimations', held);
    const original = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      const animation = original.apply(this, args);
      if (this.hasAttribute('data-nav-indicator')) {
        animation.pause();
        held.push(animation);
      }
      return animation;
    };
  });
}

interface IndicatorFrames {
  /** 两根竖条静止时的上沿。 */
  readonly from: number;
  readonly to: number;
  readonly height: number;
  /** 逐帧两根竖条覆盖的上下沿，以及结束后两根的上沿。 */
  readonly frames: readonly { top: number; bottom: number }[];
  readonly settled: readonly number[];
}

/** 把记下的动画按 0–600 ms 逐帧摆到位，量两根竖条的位置；量完取消，回到静止。 */
async function sampleIndicators(
  page: Page,
  keys: readonly [string, string],
): Promise<IndicatorFrames> {
  return page.evaluate((wanted) => {
    const held = Reflect.get(window, 'heldIndicatorAnimations');
    const animations: Animation[] = Array.isArray(held)
      ? held.filter((a) => a instanceof Animation)
      : [];
    const bars = wanted.map((key) =>
      document.querySelector<HTMLElement>(`[data-nav-indicator="${CSS.escape(key)}"]`),
    );
    const rest = (bar: HTMLElement | null) => {
      const running = bar?.getAnimations() ?? [];
      const times = running.map((animation) => animation.currentTime);
      for (const animation of running) animation.currentTime = 600;
      const box = bar?.getBoundingClientRect();
      running.forEach((animation, at) => (animation.currentTime = times[at] ?? 0));
      return box;
    };
    const target = rest(bars[1] ?? null);
    const frames: { top: number; bottom: number }[] = [];
    for (let time = 0; time < 600; time += 20) {
      for (const animation of animations) animation.currentTime = time;
      for (const bar of bars) {
        const box = bar?.getBoundingClientRect();
        if (box) frames.push({ top: box.top, bottom: box.bottom });
      }
    }
    for (const animation of animations.splice(0)) animation.cancel();
    const settled = bars.map((bar) => bar?.getBoundingClientRect().top ?? NaN);
    return {
      from: settled[0] ?? NaN,
      to: target?.top ?? NaN,
      height: target?.height ?? NaN,
      frames,
      settled,
    };
  }, keys);
}

function expectWithinPath(result: IndicatorFrames): void {
  const low = Math.min(result.from, result.to) - 0.5;
  const high = Math.max(result.from, result.to) + result.height + 0.5;
  expect(result.frames.length).toBeGreaterThan(0);
  for (const frame of result.frames) {
    expect(frame.top).toBeGreaterThanOrEqual(low);
    expect(frame.bottom).toBeLessThanOrEqual(high);
  }
}

for (const direction of ['往下', '往上'] as const) {
  test(`选中条${direction}移：两根都播，整段不出旧项与新项之间，结束正好落在新项上`, async ({
    page,
  }) => {
    const { lists, entry, errors } = await openSidebar(page);
    const road = `playlist:${lists.guid('Road Trip')}`;
    if (direction === '往上') {
      await entry('Road Trip').click();
      await expect(entry('Road Trip')).toHaveAttribute('aria-current', 'page');
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    }
    const keys: [string, string] =
      direction === '往下' ? ['item:albums', road] : [road, 'item:albums'];
    await holdIndicatorAnimations(page);
    await (direction === '往下' ? entry('Road Trip') : albumsItem(page)).click();
    // 旧项那根一段位移缩放加一段淡出，新项那根一段位移缩放。
    const started = await page.evaluate(() => {
      const held = Reflect.get(window, 'heldIndicatorAnimations');
      return Array.isArray(held) ? held.length : 0;
    });
    expect(started).toBe(3);
    const sampled = await sampleIndicators(page, keys);
    expect(direction === '往下' ? sampled.to > sampled.from : sampled.to < sampled.from).toBe(true);
    expectWithinPath(sampled);
    expect(sampled.settled[1]).toBeCloseTo(sampled.to, 0);
    expect(errors).toEqual([]);
  });
}

test('减弱动效时选中条直接到位，不播', async ({ page }) => {
  const { entry, errors } = await openSidebar(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await holdIndicatorAnimations(page);
  await entry('Road Trip').click();
  await expect(entry('Road Trip')).toHaveAttribute('aria-current', 'page');
  const count = await page.evaluate(() => {
    const held = Reflect.get(window, 'heldIndicatorAnimations');
    return Array.isArray(held) ? held.length : -1;
  });
  expect(count).toBe(0);
  expect(errors).toEqual([]);
});
