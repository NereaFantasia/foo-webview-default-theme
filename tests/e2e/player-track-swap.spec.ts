import { expect, test, type Page } from '@playwright/test';
import { TINY_PNG } from '../fixtures/hostAnswers.ts';
import { choosePlayerBar, openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 换曲过渡：文字先退后进、按方向横移；封面按形态推入、擦除、转入。只断言放了哪几段、朝哪个方向，
// 以及放完之后只剩一层封面、字是新的；节奏与观感只能实机看。

const NEXT = makeTrack({
  path: 'file://E:/Music/Other/02 Next.flac',
  title: 'Next Song',
  artist: 'Someone',
  album: 'Other Album',
  albumArtist: 'Someone',
  duration: 200,
});

interface Logged {
  readonly layer: boolean;
  readonly wipe: string | null;
  readonly frames: Record<string, unknown>[];
}

/** 页面打开前把 `Element.prototype.animate` 包一层，记下播放栏三种形态里放的每一段。 */
async function logAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: unknown[] = [];
    Reflect.set(window, '__swaps', log);
    const original = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      if (this.closest('[data-player-bar], [data-now-playing], [data-player-capsule]')) {
        log.push({
          layer: this.hasAttribute('data-layer'),
          wipe: this.getAttribute('data-wipe'),
          frames: JSON.parse(JSON.stringify(Array.isArray(keyframes) ? keyframes : [])),
        });
      }
      return original.call(this, keyframes, options);
    };
  });
}

function isLogged(value: unknown): value is Logged {
  if (typeof value !== 'object' || value === null) return false;
  const frames: unknown = Reflect.get(value, 'frames');
  return (
    typeof Reflect.get(value, 'layer') === 'boolean' &&
    Array.isArray(frames) &&
    frames.every((frame) => typeof frame === 'object' && frame !== null)
  );
}

async function logged(page: Page): Promise<Logged[]> {
  const log: unknown = await page.evaluate(() => Reflect.get(window, '__swaps'));
  return Array.isArray(log) ? log.filter(isLogged) : [];
}

/** 记下来的各段里某个属性的首尾两帧。 */
async function ends(page: Page, property: string, layer: boolean): Promise<unknown[][]> {
  return (await logged(page))
    .filter((entry) => entry.layer === layer && property in (entry.frames[0] ?? {}))
    .map((entry) => [entry.frames[0]?.[property], entry.frames.at(-1)?.[property]]);
}

/** 新一首的封面地址与上一首不同，封面才会换。 */
function coverPerTrack(player: PlayerPage): void {
  player.host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: `${TINY_PNG}#${String(params['path'])}`,
  }));
}

async function change(player: PlayerPage): Promise<void> {
  player.state.track = NEXT;
  await player.host.emit('playback:trackChanged', NEXT);
}

test('底部通栏：按下一首，字往左退、从右边进，封面从右边推进来；放完只剩一层', async ({ page }) => {
  await logAnimations(page);
  const player = await openPlayer(page);
  coverPerTrack(player);
  const bar = page.locator('[data-player-bar]');
  await bar.locator('[data-player-key="next"]').click();
  await change(player);
  await expect(bar).toContainText(NEXT.title);
  await expect
    .poll(() => ends(page, 'translate', false))
    .toEqual([
      ['0 0', '-8px 0'],
      ['8px 0', '0 0'],
    ]);
  await expect
    .poll(() => ends(page, 'translate', true))
    .toEqual([
      ['100% 0', '0 0'],
      ['0 0', '-33% 0'],
    ]);
  await expect(bar.locator('[data-layer]')).toHaveCount(1);
  await expect(bar.locator('[data-layer] img')).toHaveAttribute('src', /#file:/);
  expect(player.errors).toEqual([]);
});

test('正在播放条：按上一首，字往右退，封面从左往右擦开', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  await logAnimations(page);
  const player = await openPlayer(page);
  coverPerTrack(player);
  await page.locator('header [data-player-key="previous"]').click();
  await change(player);
  const strip = page.locator('[data-now-playing]');
  await expect(strip).toContainText(NEXT.title);
  await expect
    .poll(async () => (await ends(page, 'translate', false)).slice(0, 2))
    .toEqual([
      ['0 0', '8px 0'],
      ['0 0', '8px 0'],
    ]);
  await expect
    .poll(async () => (await logged(page)).filter((entry) => entry.wipe === 'right').length)
    .toBe(1);
  await expect(strip.locator('[data-layer]')).toHaveCount(1);
  await expect(strip.locator('[data-layer]')).not.toHaveAttribute('data-wipe');
  expect(player.errors).toEqual([]);
});

test('胶囊：上一首播到结尾自己接下一首，字从右边进，封面顺时针转进来', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  await logAnimations(page);
  const player = await openPlayer(page);
  coverPerTrack(player);
  await player.host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 239 });
  await change(player);
  await expect(page.locator('[data-player-capsule]')).toContainText(NEXT.title);
  await expect.poll(() => ends(page, 'rotate', true)).toEqual([['-20deg', '0deg']]);
  await expect.poll(() => ends(page, 'translate', false)).toContainEqual(['8px 0', '0 0']);
  expect(player.errors).toEqual([]);
});

test('减弱动效时直接换：字与封面都不放过渡', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await logAnimations(page);
  const player = await openPlayer(page);
  coverPerTrack(player);
  const bar = page.locator('[data-player-bar]');
  await bar.locator('[data-player-key="next"]').click();
  await change(player);
  await expect(bar).toContainText(NEXT.title);
  await expect(bar.locator('[data-layer] img')).toHaveAttribute('src', /#file:/);
  expect(await ends(page, 'translate', false)).toEqual([]);
  expect(await ends(page, 'translate', true)).toEqual([]);
  expect(player.errors).toEqual([]);
});
