import { QUEUE_LIST_GUID } from '../fixtures/rightCardPage.ts';
import { expect, test, type Page } from '@playwright/test';
import { openLargeQueue, queueScroller } from '../fixtures/rightCardPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

interface Frame {
  height: number;
  scroll: number;
  width: number;
  empty: boolean;
  rows: number;
}
interface Watch {
  frames: Frame[];
  stopped: boolean;
  node: HTMLElement;
  key: string;
  top: number;
}

async function watch(page: Page) {
  return page.locator('[data-queue-page]').evaluate((root) => {
    const box = root.parentElement;
    if (!box) throw new Error('缺少滚动容器');
    const bounds = box.getBoundingClientRect();
    const node = [...root.querySelectorAll<HTMLElement>('[data-kind="upnext"]')].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom < bounds.bottom;
    });
    if (!node) throw new Error('缺少可见曲目');
    const recording: Watch = {
      frames: [],
      stopped: false,
      node,
      key: node.dataset.queueRow ?? '',
      top: node.getBoundingClientRect().top,
    };
    Reflect.set(window, 'queueContinuity', recording);
    const frame = () => {
      if (recording.stopped) return;
      recording.frames.push({
        height: box.scrollHeight,
        scroll: box.scrollTop,
        width: box.clientWidth,
        empty: !!root.querySelector('[data-queue-empty]'),
        rows: root.querySelectorAll('[data-kind="upnext"]').length,
      });
      requestAnimationFrame(frame);
    };
    frame();
    return recording.frames[0];
  });
}
async function finish(page: Page) {
  return page.evaluate(() => {
    const recording: Watch = Reflect.get(window, 'queueContinuity');
    recording.stopped = true;
    const node = document.querySelector<HTMLElement>(
      `[data-queue-row="${CSS.escape(recording.key)}"]`,
    );
    return {
      frames: recording.frames,
      sameNode: node === recording.node,
      topDelta: node ? node.getBoundingClientRect().top - recording.top : null,
    };
  });
}
const track = (index: number) =>
  makeTrack({ path: `file://E:/Music/queue/${index}.flac`, title: `曲目 ${index}` });

test('慢速换曲全程保留 DOM、滚动高度与阅读锚点，不出现中间空状态', async ({ page }) => {
  const player = await openLargeQueue(page, 5000);
  await queueScroller(page).evaluate((box) => {
    box.style.overflowAnchor = 'none';
    box.scrollTop = 48 * 2500;
  });
  await expect(page.locator('[data-kind="upnext"]').filter({ hasText: /曲目 2501/ })).toHaveCount(
    1,
  );
  const before = await watch(page);
  const positions = player.host.hold('playback.getCurrentTrackIndex');
  const pages = player.host.hold('playlist.getTracks');
  player.state.track = track(1);
  await player.host.emit('playback:trackChanged', player.state.track);
  const body = page.locator('[data-queue-virtual-list]');
  await expect(body).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 350)));
  const heldHeight = await queueScroller(page).evaluate((box) => box.scrollHeight);
  expect(heldHeight).toBe(before.height);
  positions.respond(0, {
    playlistGuid: QUEUE_LIST_GUID,
    success: true,
    found: true,
    playlist: 0,
    index: 1,
  });
  await expect.poll(() => pages.pending.length).toBeGreaterThan(0);
  expect(await queueScroller(page).evaluate((box) => box.scrollHeight)).toBe(before.height);
  pages.release();
  await expect(body).toHaveAttribute('aria-busy', 'false');
  // 「接下来」少了一行，当前曲目前面多出一行（连同它与当前卡之间的 8），两段同时换上。
  await expect
    .poll(() => queueScroller(page).evaluate((box) => box.scrollHeight))
    .toBe(before.height + 8);
  await expect
    .poll(() =>
      page
        .locator('[data-kind="upnext"]')
        .evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length),
    )
    .toBe(0);
  const result = await finish(page);
  expect(result.frames.length).toBeGreaterThan(10);
  expect(
    result.frames.every((frame) => !frame.empty && frame.rows > 0 && frame.width === before.width),
  ).toBe(true);
  expect(result.frames.every((frame) => frame.height >= before.height - 48)).toBe(true);
  expect(result.frames.every((frame) => frame.scroll >= before.scroll - 49)).toBe(true);
  expect(result.sameNode).toBe(true);
  expect(Math.abs(result.topDelta ?? Infinity)).toBeLessThan(2);
  expect(player.errors).toEqual([]);
});

test('连续换曲只发布最后可信范围，队首 DOM 复用且退场层不撑高滚动区', async ({ page }) => {
  const player = await openLargeQueue(page, 60);
  await watch(page);
  const positions = player.host.hold('playback.getCurrentTrackIndex');
  for (const index of [1, 2, 3]) {
    player.state.track = track(index);
    await player.host.emit('playback:trackChanged', player.state.track);
  }
  await expect.poll(() => positions.pending.length).toBe(3);
  positions.respond(2, {
    playlistGuid: QUEUE_LIST_GUID,
    success: true,
    found: true,
    playlist: 0,
    index: 3,
  });
  await expect(page.locator('[data-kind="upnext"]').first()).toContainText('曲目 4');
  positions.respond(0, {
    playlistGuid: QUEUE_LIST_GUID,
    success: true,
    found: true,
    playlist: 0,
    index: 1,
  });
  positions.respond(0, {
    playlistGuid: QUEUE_LIST_GUID,
    success: true,
    found: true,
    playlist: 0,
    index: 2,
  });
  await expect.poll(() => page.locator('[data-queue-motion-layer]').count()).toBe(0);
  const result = await finish(page);
  expect(result.frames.every((frame) => !frame.empty && frame.rows > 0)).toBe(true);
  expect(new Set(result.frames.map((frame) => frame.height)).size).toBeLessThanOrEqual(2);
  await expect(page.locator('[data-kind="upnext"]').first()).toContainText('曲目 4');
  expect(player.errors).toEqual([]);
});
