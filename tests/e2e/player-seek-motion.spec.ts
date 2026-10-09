import { expect, test, type Locator, type Page } from '@playwright/test';
import { choosePlayerBar, openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

const slider = (page: Page) => page.getByRole('slider', { name: '播放进度' });
const progress = (seek: Locator) =>
  seek.evaluate((element) => Number(element.style.getPropertyValue('--seek-progress')));
const indicator = (seek: Locator) =>
  seek.evaluate((element) => Number(element.style.getPropertyValue('--seek-indicator')));

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
    await choosePlayerBar(page, form);
    const env = await openPlayer(page);
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
    await freeze(page);
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
    await choosePlayerBar(page, form);
    const env = await openPlayer(page);
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
    await freeze(page);
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
    expect(await progress(seek)).toBe(0);
    expect(env.errors).toEqual([]);
  });

  test(`${form}：切歌与同曲重播归零，标签更新不重播动画`, async ({ page }) => {
    await choosePlayerBar(page, form);
    const env = await openPlayer(page, { state: { position: 180 } });
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(0.75);
    await freeze(page);
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
    await env.host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 120 });
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
  await choosePlayerBar(page, 'bottom');
  const env = await openPlayer(page);
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  await freeze(page);
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
    await choosePlayerBar(page, 'bottom');
    const env = await openPlayer(page);
    const seek = slider(page);
    await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
    await freeze(page);
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
  await choosePlayerBar(page, 'bottom');
  const track = makeTrack({ duration: 10 });
  const env = await openPlayer(page, { state: { track, position: 1.2 } });
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(0.12);
  const held = env.host.hold('playback.getPosition');
  try {
    await freeze(page);
    await seek.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => held.pending.length).toBe(1);
    await expect(seek).toHaveAttribute('aria-valuenow', '0');
    await env.host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 1.3 });
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
      hostTime: Date.now(),
      path: track.path,
      subsong: track.subsong,
      duration: 10,
    } as const;
    held.respond(0, { ...response, position: 0 });
    await expect(seek).toHaveAttribute('aria-valuenow', '5');
    held.respond(0, { ...response, position: 5 });
    await page.clock.runFor(200);
    await expect(seek).toHaveAttribute('aria-valuenow', '5');
    expect(await progress(seek)).toBeCloseTo(0.5);
    expect(env.errors).toEqual([]);
  } finally {
    held.release();
  }
});

test('拖动中同曲重播会取消旧手势并归零，松手不提交旧目标', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const env = await openPlayer(page);
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  await freeze(page);
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
  expect(await progress(seek)).toBe(0);
  expect(env.errors).toEqual([]);
});

test('跳转未成功时到期缓动交回真实位置，不被进度刷新无限续期', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  const env = await openPlayer(page);
  env.host.answer('playback.setPosition', hostFailure('INTERNAL_ERROR'));
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  await freeze(page);
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  await expect(seek).toHaveAttribute('aria-valuenow', '47');
  for (let i = 0; i < 6; i++) {
    await env.host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 42 });
    await page.clock.runFor(200);
  }
  await expect(seek).toHaveAttribute('aria-valuenow', '42');
  await page.clock.runFor(200);
  expect(await progress(seek)).toBeCloseTo(42 / 240);
  expect(env.errors).toEqual([]);
});

test('减弱动效时键盘跳转与切歌直接到位', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choosePlayerBar(page, 'capsule');
  const env = await openPlayer(page);
  const seek = slider(page);
  await expect.poll(() => progress(seek)).toBeCloseTo(42 / 240);
  await freeze(page);
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  await expect(seek).toHaveAttribute('aria-valuenow', '47');
  expect(await progress(seek)).toBeCloseTo(47 / 240);
  if (!env.state.track) throw new Error('当前没有曲目');
  env.state.position = 0;
  await env.host.emit('playback:trackChanged', env.state.track);
  await expect(seek).toHaveAttribute('aria-valuenow', '0');
  expect(await progress(seek)).toBe(0);
  expect(env.errors).toEqual([]);
});
