import { QUEUE_LIST_GUID } from '../fixtures/rightCardPage.ts';
import { expect, test, type Page } from '@playwright/test';
import { openLargeQueue, queueScroller } from '../fixtures/rightCardPage.ts';
import { installFakeQueue, queueTracks } from '../fixtures/fakeQueue.ts';
import { makeTrack } from '../fixtures/tracks.ts';

interface MotionLog {
  kind: string;
  part: string;
  exit: boolean;
  transforms: string[];
  duration: number;
  delay: number;
}

async function record(page: Page) {
  await page.evaluate(() => {
    const logs: MotionLog[] = [];
    Reflect.set(window, 'queueMotionLog', logs);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (
        this instanceof HTMLElement &&
        (this.dataset.kind || this.dataset.currentPart || this.hasAttribute('data-queue-exit'))
      ) {
        logs.push({
          kind: this.dataset.kind ?? '',
          part: this.dataset.currentPart ?? '',
          exit: this.hasAttribute('data-queue-exit'),
          transforms: Array.isArray(frames)
            ? frames.flatMap((frame) =>
                typeof frame.transform === 'string' ? [frame.transform] : [],
              )
            : [],
          duration: typeof options === 'object' ? Number(options.duration) : Number(options),
          delay: typeof options === 'object' ? Number(options.delay ?? 0) : 0,
        });
      }
      return animate.call(this, frames, options);
    };
  });
}
const logs = (page: Page): Promise<MotionLog[]> =>
  page.evaluate(() => Reflect.get(window, 'queueMotionLog'));
const clear = (page: Page) =>
  page.evaluate(() => {
    Reflect.get(window, 'queueMotionLog').length = 0;
  });
const sourceTrack = (index: number) =>
  makeTrack({ path: `file://E:/Music/queue/${index}.flac`, title: `曲目 ${index}` });

test('换曲向上接续，从历史重播向下返回，重复同曲不重播动画', async ({ page }) => {
  const player = await openLargeQueue(page, 50);
  await record(page);
  const change = async (index: number) => {
    player.state.track = sourceTrack(index);
    player.host.answer('playback.getCurrentTrackIndex', {
      playlistGuid: QUEUE_LIST_GUID,
      success: true,
      found: true,
      playlist: 0,
      index,
    });
    await player.host.emit('playback:trackChanged', player.state.track);
    await expect(page.locator('[data-queue-current]')).toContainText(`曲目 ${index}`);
  };
  await change(1);
  await expect
    .poll(async () =>
      (await logs(page)).some(
        (log) => log.part === 'text' && log.transforms[0] === 'translate(0px, 12px)',
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await logs(page)).some(
        (log) => log.exit && log.transforms.at(-1) === 'translate(0px, -12px)',
      ),
    )
    .toBe(true);
  await expect.poll(() => page.locator('[data-queue-exit]').count()).toBe(0);
  await clear(page);
  await change(0);
  await expect
    .poll(async () =>
      (await logs(page)).some(
        (log) => log.part === 'text' && log.transforms[0] === 'translate(0px, -12px)',
      ),
    )
    .toBe(true);
  await expect.poll(() => page.locator('[data-queue-exit]').count()).toBe(0);
  await clear(page);
  await change(0);
  expect((await logs(page)).filter((log) => log.part)).toEqual([]);
  expect(player.errors).toEqual([]);
});

test('入队从右进入，移除向右退场，重排按实际位移且副本不能操作', async ({ page }) => {
  const player = await openLargeQueue(page, 50);
  const tracks = queueTracks('第一首', '第二首', '第三首');
  const queue = installFakeQueue(player.host, tracks);
  await player.host.emit('playback:queueChanged', { origin: 'user_added', count: 3 });
  await expect(page.locator('[data-kind="queued"]')).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .locator('[data-kind="queued"]')
        .first()
        .evaluate((node) => node.getAnimations().length),
    )
    .toBe(0);
  await record(page);
  queue.set([tracks[2], tracks[0], tracks[1]]);
  await player.host.emit('playback:queueChanged', { origin: 'unknown', count: 3 });
  await expect
    .poll(async () =>
      (await logs(page)).some(
        (log) =>
          log.kind === 'queued' && log.duration === 250 && log.transforms[0] === 'translateY(96px)',
      ),
    )
    .toBe(true);
  await clear(page);
  queue.set([tracks[2], tracks[1]]);
  await player.host.emit('playback:queueChanged', { origin: 'user_removed', count: 2 });
  await expect
    .poll(async () =>
      (await logs(page)).some(
        (log) => log.exit && log.transforms.at(-1) === 'translate(16px, 0px)',
      ),
    )
    .toBe(true);
  expect(
    await page
      .locator('[data-queue-exit]')
      .evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            node instanceof HTMLElement &&
            node.inert &&
            node.getAttribute('aria-hidden') === 'true' &&
            !node.hasAttribute('data-queue-row'),
        ),
      ),
  ).toBe(true);
  await expect.poll(() => page.locator('[data-queue-exit]').count()).toBe(0);
  await clear(page);
  queue.set(tracks);
  await player.host.emit('playback:queueChanged', { origin: 'user_added', count: 3 });
  await expect
    .poll(async () =>
      (await logs(page)).some(
        (log) =>
          log.kind === 'queued' &&
          log.transforms[0] === 'translate(16px, 0px)' &&
          log.delay === 167,
      ),
    )
    .toBe(true);
  await expect.poll(() => page.locator('[data-queue-exit]').count()).toBe(0);
  expect(player.errors).toEqual([]);
});

test('来源延迟保留不可操作的旧布局，快切与减弱动效清理，补页不飞入', async ({ page }) => {
  const player = await openLargeQueue(page, 120000);
  await record(page);
  const held = player.host.hold('playback.getCurrentTrackIndex');
  for (const index of [1, 2, 3]) {
    player.state.track = sourceTrack(index);
    await player.host.emit('playback:trackChanged', player.state.track);
  }
  await expect(page.locator('[data-queue-current]')).toContainText('曲目 3');
  await expect(page.locator('[data-queue-virtual-list]')).toHaveAttribute('inert', '');
  await expect(page.locator('[data-kind="upnext"]').first()).toContainText('曲目 1');
  await expect.poll(() => page.locator('[data-queue-exit]').count()).toBe(0);
  player.host.answer('playback.getCurrentTrackIndex', {
    playlistGuid: QUEUE_LIST_GUID,
    success: true,
    found: true,
    playlist: 0,
    index: 3,
  });
  held.release();
  await expect(page.locator('[data-kind="upnext"]').first()).toContainText('曲目 4');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page
        .locator('[data-queue-page]')
        .evaluate((node) => getComputedStyle(node).getPropertyValue('--motion-fast').trim()),
    )
    .toBe('1ms');
  await clear(page);
  await player.host.emit('playback:trackChanged', sourceTrack(4));
  await expect.poll(() => page.locator('[data-queue-exit]').count()).toBe(0);
  expect((await logs(page)).every((log) => log.duration <= 1 && log.delay === 0)).toBe(true);
  await clear(page);
  await queueScroller(page).evaluate((box) => {
    box.scrollTop = 48 * 50000;
  });
  await expect.poll(() => page.locator('[data-kind="upnext"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-kind="upnext"]').count()).toBeLessThan(80);
  expect((await logs(page)).filter((log) => log.kind === 'upnext')).toEqual([]);
  expect(player.errors).toEqual([]);
});

test('历史底部跟随时仍向上接入，手动滚动立即结束补位', async ({ page }) => {
  const player = await openLargeQueue(page, 60);
  for (let index = 1; index <= 10; index++)
    await player.host.emit('playback:trackChanged', sourceTrack(index));
  await page.locator('[data-queue-review-toggle]').click();
  await expect
    .poll(() =>
      page
        .locator('[data-queue-page]')
        .locator('..')
        .evaluate((node) => node.getAnimations().length),
    )
    .toBe(0);
  await record(page);
  await player.host.emit('playback:trackChanged', sourceTrack(11));
  await expect
    .poll(async () =>
      (await logs(page)).some(
        (log) => log.kind === 'review' && log.transforms[0] === 'translate(0px, 12px)',
      ),
    )
    .toBe(true);
  await page.locator('[data-queue-review-records]').evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect
    .poll(() =>
      page
        .locator('[data-kind="review"]')
        .evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length),
    )
    .toBe(0);
  await expect.poll(() => page.locator('[data-queue-exit]').count()).toBe(0);
  expect(player.errors).toEqual([]);
});
