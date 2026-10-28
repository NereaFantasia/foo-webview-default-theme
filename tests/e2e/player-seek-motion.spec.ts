import { expect, test, type Locator, type Page } from '@playwright/test';
import { choosePlayerBar, openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

const slider = (page: Page) => page.getByRole('slider', { name: '播放进度' });
const progress = (seek: Locator) =>
  seek.evaluate((element) => Number(element.style.getPropertyValue('--seek-progress')));
const indicator = (seek: Locator) =>
  seek.evaluate((element) => Number(element.style.getPropertyValue('--seek-indicator')));

/** 页内此刻的时间：冻结时钟里页内与 Node 的 Date 不同步，事件 hostTime 要取页内的才过得了送达校验。 */
const pageNow = (page: Page) => page.evaluate(() => Date.now());

async function freeze(page: Page) {
  const start = new Date('2026-10-07T12:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 10_000));
}

async function recordProgress(seek: Locator) {
  await seek.evaluate((element) => {
    const trace: number[] = [];
    Reflect.set(element, 'seekProgressTrace', trace);
    const observer = new MutationObserver(() => {
      trace.push(Number(element.style.getPropertyValue('--seek-progress')));
    });
    observer.observe(element, { attributes: true, attributeFilter: ['style'] });
  });
}

const traceOf = (seek: Locator) =>
  seek.evaluate((element) => {
    const values: unknown = Reflect.get(element, 'seekProgressTrace');
    return Array.isArray(values)
      ? values.filter((value): value is number => typeof value === 'number')
      : [];
  });

for (const form of ['bottom', 'titlebar', 'capsule'] as const) {
  test(`${form}：鼠标seek时指示器贴着光标，松手后也不退回尚未到位的填充末端`, async ({ page }) => {
    await freeze(page);
    await choosePlayerBar(page, form);
    const env = await openPlayer(page);
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
    const box = await seek.boundingBox();
    if (!box) throw new Error('进度条没有显示');
    const x = box.x + box.width * 0.65;
    const y = box.y + box.height / 2;
    const marker = seek.locator(form === 'bottom' ? '[data-seek-thumb]' : '[data-seek-preview]');
    const markerCenter = () =>
      marker.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left + bounds.width / 2;
      });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect(seek).toHaveAttribute('aria-valuenow', '156');
    await expect(marker).toHaveCSS('opacity', '1');
    // 字形与轨道按子像素排版，位置比较允许半个CSS像素的取整差异。
    expect(await markerCenter()).toBeCloseTo(x, 0);
    expect(await progress(seek)).toBeCloseTo(42 / 240);
    await page.mouse.up();
    await expect.poll(() => env.state.position).toBeCloseTo(156);
    expect(await markerCenter()).toBeCloseTo(x, 0);
    expect(await progress(seek)).toBeCloseTo(42 / 240);
    await page.clock.runFor(80);
    expect(await markerCenter()).toBeCloseTo(x, 0);
    expect(await progress(seek)).toBeLessThan(0.65);
    await page.clock.runFor(120);
    expect(await progress(seek)).toBeCloseTo(0.65);
    expect(env.errors).toEqual([]);
  });

  test(`${form}：键盘目标立即更新，位置缓动，连续按键累加，Home回到开头`, async ({ page }) => {
    await freeze(page);
    await choosePlayerBar(page, form);
    const env = await openPlayer(page);
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
    await seek.focus();
    await page.keyboard.press('ArrowRight');
    await expect(seek).toHaveAttribute('aria-valuenow', '47');
    expect(await progress(seek)).toBeCloseTo(42 / 240);
    await page.clock.runFor(80);
    expect(await progress(seek)).toBeGreaterThan(42 / 240);
    expect(await progress(seek)).toBeLessThan(47 / 240);
    await page.clock.runFor(120);
    expect(await progress(seek)).toBeCloseTo(47 / 240);

    await seek.evaluate((element) => {
      for (let i = 0; i < 3; i++)
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await expect(seek).toHaveAttribute('aria-valuenow', '62');
    await page.clock.runFor(200);
    expect(await progress(seek)).toBeCloseTo(62 / 240);
    await page.keyboard.press('Home');
    await expect(seek).toHaveAttribute('aria-valuenow', '0');
    await page.clock.runFor(180);
    expect(await progress(seek)).toBeGreaterThan(0);
    await page.clock.runFor(100);
    expect(await progress(seek)).toBeCloseTo(0, 1);
    expect(env.errors).toEqual([]);
  });

  test(`${form}：切歌与同曲重播归零，标签更新不重播动画`, async ({ page }) => {
    await freeze(page);
    await choosePlayerBar(page, form);
    const env = await openPlayer(page, { state: { position: 180 } });
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(0.75);
    await recordProgress(seek);
    const next = makeTrack({ path: 'file://E:/Music/next.flac', duration: 600 });
    env.state.track = next;
    env.state.position = 0.2;
    await env.host.emit('playback:trackChanged', next);
    await expect(seek).toHaveAttribute('aria-valuemax', '600');
    expect(await progress(seek)).toBeCloseTo(0.75);
    await page.clock.runFor(100);
    expect(await progress(seek)).toBeGreaterThan(0);
    expect(await progress(seek)).toBeLessThan(0.75);
    await page.clock.runFor(900);
    expect(await traceOf(seek)).toContain(0);
    expect(await progress(seek)).toBeCloseTo(0.2 / 600);

    env.state.position = 120;
    await env.host.emit('playback:timeHighRes', { hostTime: await pageNow(page), position: 120 });
    await expect.poll(() => progress(seek)).toBeCloseTo(0.2);
    await env.host.emit('playback:edited', { ...next, title: '更新标题' });
    await page.clock.runFor(300);
    expect(await progress(seek)).toBeCloseTo(0.2);
    env.state.position = 0.1;
    await env.host.emit('playback:trackChanged', next);
    expect(await progress(seek)).toBeCloseTo(0.2);
    await page.clock.runFor(100);
    expect(await progress(seek)).toBeGreaterThan(0);
    expect(await progress(seek)).toBeLessThan(0.2);
    await page.clock.runFor(900);
    expect(await progress(seek)).toBeCloseTo(0.1 / 600);
    expect(env.errors).toEqual([]);
  });
}

test('点击缓动可被拖动接管，Esc回退时目标值立即交还，填充随后到位', async ({ page }) => {
  await freeze(page);
  await choosePlayerBar(page, 'bottom');
  const env = await openPlayer(page);
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  const box = await seek.boundingBox();
  if (!box) throw new Error('进度条没有显示');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await expect(seek).toHaveAttribute('aria-valuenow', '120');
  expect(await progress(seek)).toBeCloseTo(42 / 240);
  await page.clock.runFor(80);
  expect(await progress(seek)).toBeGreaterThan(42 / 240);
  await page.mouse.move(box.x + box.width * 0.75, y);
  await expect(seek).toHaveAttribute('aria-valuenow', '180');
  expect(await progress(seek)).toBeCloseTo(0.75);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(seek).toHaveAttribute('aria-valuenow', '42');
  expect(await progress(seek)).toBeCloseTo(0.75);
  await page.clock.runFor(200);
  expect(await progress(seek)).toBeCloseTo(42 / 240);
  expect(env.calls('playback.setPosition')).toEqual([]);
  expect(env.errors).toEqual([]);
});

for (const action of ['Escape', 'ArrowRight', 'track'] as const) {
  test(`鼠标指示器先到目标后接${action}，从自身位置连续运动`, async ({ page }) => {
    await freeze(page);
    await choosePlayerBar(page, 'bottom');
    const env = await openPlayer(page);
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
    const box = await seek.boundingBox();
    if (!box || !env.state.track) throw new Error('进度条没有显示');
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2);
    await page.mouse.down();
    expect(await indicator(seek)).toBeCloseTo(0.65);
    expect(await progress(seek)).toBeCloseTo(42 / 240);
    let target: number;
    if (action === 'track') {
      env.state.position = 0;
      await env.host.emit('playback:trackChanged', env.state.track);
      target = 0;
    } else {
      if (action === 'ArrowRight') await page.mouse.up();
      await page.keyboard.press(action);
      target = action === 'Escape' ? 42 : 161;
    }
    await expect(seek).toHaveAttribute('aria-valuenow', String(target));
    expect(await indicator(seek)).toBeCloseTo(0.65);
    await page.mouse.up();
    await page.clock.runFor(80);
    const middle = await indicator(seek);
    expect(middle).toBeGreaterThan(Math.min(0.65, target / 240));
    expect(middle).toBeLessThan(Math.max(0.65, target / 240));
    await page.clock.runFor(action === 'track' ? 800 : 220);
    expect(await indicator(seek)).toBeCloseTo(target / 240);
    expect(await progress(seek)).toBeCloseTo(target / 240);
    expect(env.errors).toEqual([]);
  });
}

test('开头附近Home等待回读时保留零点目标，旧进度和旧应答不影响随后按键累加', async ({ page }) => {
  await freeze(page);
  await choosePlayerBar(page, 'bottom');
  const track = makeTrack({ duration: 10 });
  const env = await openPlayer(page, { state: { track, position: 1.2 } });
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(0.12);
  const held = env.host.hold('playback.getPosition');
  try {
    await seek.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => held.pending.length).toBe(1);
    await expect(seek).toHaveAttribute('aria-valuenow', '0');
    await env.host.emit('playback:timeHighRes', { hostTime: await pageNow(page), position: 1.3 });
    await expect(seek).toHaveAttribute('aria-valuenow', '0');
    await page.clock.runFor(80);
    expect(await progress(seek)).toBeGreaterThan(0);
    expect(await progress(seek)).toBeLessThan(0.12);
    await page.keyboard.press('ArrowRight');
    await expect(seek).toHaveAttribute('aria-valuenow', '5');
    await expect.poll(() => held.pending.length).toBe(2);
    expect(env.calls('playback.setPosition').map((call) => call['position'])).toEqual([0, 5]);
    const response = {
      success: true,
      hostTime: await pageNow(page),
      path: track.path,
      subsong: track.subsong,
      duration: 10,
    } as const;
    held.respond(0, { ...response, position: 0 });
    await expect(seek).toHaveAttribute('aria-valuenow', '5');
    held.respond(0, { ...response, position: 5 });
    await page.clock.runFor(200);
    await expect(seek).toHaveAttribute('aria-valuenow', '5');
    expect(await progress(seek)).toBeCloseTo(0.5, 1);
    expect(env.errors).toEqual([]);
  } finally {
    held.release();
  }
});

test('拖动中同曲重播会取消旧手势并归零，松手不提交旧目标', async ({ page }) => {
  await freeze(page);
  await choosePlayerBar(page, 'capsule');
  const env = await openPlayer(page);
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  const box = await seek.boundingBox();
  if (!box || !env.state.track) throw new Error('进度条没有显示');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y);
  expect(await progress(seek)).toBeCloseTo(0.8);
  env.state.position = 0;
  await env.host.emit('playback:trackChanged', env.state.track);
  await expect(seek).not.toHaveAttribute('data-dragging');
  await expect(seek).toHaveAttribute('aria-valuenow', '0');
  await page.mouse.up();
  expect(env.calls('playback.setPosition')).toEqual([]);
  await page.clock.runFor(100);
  expect(await progress(seek)).toBeGreaterThan(0);
  expect(await progress(seek)).toBeLessThan(0.8);
  await page.clock.runFor(800);
  expect(await progress(seek)).toBeCloseTo(0, 1);
  expect(env.errors).toEqual([]);
});

test('跳转未成功时到期缓动交回真实位置，不被进度刷新无限续期', async ({ page }) => {
  await freeze(page);
  await choosePlayerBar(page, 'titlebar');
  const env = await openPlayer(page);
  env.host.answer('playback.setPosition', hostFailure('INTERNAL_ERROR'));
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  await expect(seek).toHaveAttribute('aria-valuenow', '47');
  for (let i = 0; i < 6; i++) {
    await env.host.emit('playback:timeHighRes', { hostTime: await pageNow(page), position: 42 });
    await page.clock.runFor(200);
  }
  await expect(seek).toHaveAttribute('aria-valuenow', '42');
  await page.clock.runFor(200);
  expect(await progress(seek)).toBeCloseTo(42 / 240);
  expect(env.errors).toEqual([]);
});

test('减弱动效时键盘跳转与切歌直接到位', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freeze(page);
  await choosePlayerBar(page, 'capsule');
  const env = await openPlayer(page);
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  await expect(seek).toHaveAttribute('aria-valuenow', '47');
  expect(await progress(seek)).toBeCloseTo(47 / 240);
  if (!env.state.track) throw new Error('当前没有曲目');
  env.state.position = 0;
  await env.host.emit('playback:trackChanged', env.state.track);
  await expect(seek).toHaveAttribute('aria-valuenow', '0');
  expect(await progress(seek)).toBeCloseTo(0, 1);
  expect(env.errors).toEqual([]);
});

test('手动切歌：宿主先报 starting 与归零的状态，隔一阵才报新曲目，进度照样从旧位置缓动归零', async ({
  page,
}) => {
  await freeze(page);
  await choosePlayerBar(page, 'bottom');
  const env = await openPlayer(page, { state: { position: 180 } });
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(0.75);
  await recordProgress(seek);
  // 真实宿主的顺序：stopped、starting 与一条位置归零的 stateChanged 立刻到，解码器打开新曲目后才有 trackChanged
  env.state.position = 0;
  await env.host.emit('playback:stopped', { reason: 'starting_another' });
  await env.host.emit('playback:starting', { command: 'next', paused: false });
  await env.host.emit('playback:stateChanged', {
    hostTime: await pageNow(page),
    state: 'playing',
    position: 0,
    duration: 0,
    canSeek: false,
  });
  await page.clock.runFor(100);
  expect(await progress(seek), '点下一首后立刻开始回落，不等新曲目').toBeLessThan(0.75);
  expect(await progress(seek), '回落是缓动，不是一帧跳到 0').toBeGreaterThan(0.05);
  await page.clock.runFor(200);
  const next = makeTrack({ path: 'file://E:/Music/next.flac', duration: 600 });
  env.state.track = next;
  await env.host.emit('playback:trackChanged', next);
  await page.clock.runFor(1500);
  expect(await traceOf(seek)).toContain(0);
  expect(await progress(seek)).toBeCloseTo(0, 2);
  expect(env.errors).toEqual([]);
});

test('新曲目时长未知（在线曲目开流前）也从旧位置缓动归零', async ({ page }) => {
  await freeze(page);
  await choosePlayerBar(page, 'bottom');
  const env = await openPlayer(page, { state: { position: 180 } });
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(0.75);
  await recordProgress(seek);
  const next = makeTrack({ path: 'file://E:/Music/next.flac', duration: 0 });
  env.state.track = next;
  env.state.position = 0;
  await env.host.emit('playback:trackChanged', next);
  expect(await progress(seek)).toBeCloseTo(0.75);
  await page.clock.runFor(100);
  expect(await progress(seek)).toBeGreaterThan(0);
  expect(await progress(seek)).toBeLessThan(0.75);
  await page.clock.runFor(900);
  expect(await traceOf(seek)).toContain(0);
  expect(await progress(seek)).toBeCloseTo(0, 2);
  expect(env.errors).toEqual([]);
});

test('两拍进度事件之间按时钟逐帧前进，新一拍对准位置，暂停时停住', async ({ page }) => {
  await freeze(page);
  await choosePlayerBar(page, 'bottom');
  const env = await openPlayer(page);
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  // 没有新的进度事件，时钟估计照样带着填充走；3 秒虚时大约走 3/240。
  await page.clock.runFor(3000);
  const ahead = await progress(seek);
  expect(ahead).toBeGreaterThan((42 + 2.5) / 240);
  expect(ahead).toBeLessThan((42 + 3.5) / 240);
  // 新一拍对准：报来的位置接管估计，不再从上一帧续走。
  env.state.position = 46;
  await env.host.emit('playback:timeHighRes', { hostTime: await pageNow(page), position: 46 });
  await page.clock.runFor(150);
  const synced = await progress(seek);
  expect(synced).toBeGreaterThanOrEqual(46 / 240 - 0.001);
  expect(synced).toBeLessThan((46 + 0.3) / 240);
  // 暂停：估计与画面都停住。
  env.state.state = 'paused';
  await env.host.emit('playback:paused', { paused: true });
  await page.clock.runFor(100);
  const held = await progress(seek);
  await page.clock.runFor(1000);
  expect(await progress(seek)).toBe(held);
  expect(env.errors).toEqual([]);
});
