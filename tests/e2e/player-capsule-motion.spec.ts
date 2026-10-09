import { expect, test, type Page } from '@playwright/test';
import {
  choosePlayerBar,
  openPlayer,
  PLAYING_TRACK,
  switchPreference,
} from '../fixtures/playerPage.ts';
import { enterSettings } from '../fixtures/settingsPage.ts';

test.use({ screenshot: 'off' });

const capsule = (page: Page) => page.locator('[data-player-capsule]');

async function watchTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events: { property: string; entering: boolean; duration: number }[] = [];
    Reflect.set(window, '__capsuleTransitions', events);
    document.addEventListener('transitionrun', (event) => {
      const node = event.target;
      if (!(node instanceof HTMLElement) || !node.matches('[data-player-capsule]')) return;
      const entering = node.hasAttribute('data-visible');
      const animation = node
        .getAnimations()
        .find(
          (entry) =>
            entry instanceof CSSTransition && entry.transitionProperty === event.propertyName,
        );
      events.push({
        property: event.propertyName,
        entering,
        duration: Number(animation?.effect?.getTiming().duration ?? 0),
      });
      if (
        !entering &&
        event.propertyName === 'opacity' &&
        Reflect.get(window, '__pauseCapsuleExit')
      ) {
        animation?.pause();
      }
    });
  });
}

async function alphaOf(page: Page): Promise<number> {
  return capsule(page).evaluate((element) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法读取胶囊底色');
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] / 255;
  });
}

for (const scheme of ['light', 'dark'] as const) {
  for (const source of ['cover', 'material'] as const) {
    test(`不透明背景下胶囊保留低浓度磨砂，切换材质有过渡：${scheme} ${source}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
      await choosePlayerBar(page, 'capsule');
      await watchTransitions(page);
      await page.addInitScript((value) => {
        localStorage.setItem(
          'default-theme.window-background.v1',
          JSON.stringify({ source: value }),
        );
        localStorage.setItem('default-theme.backdrop.v1', 'none');
        Object.defineProperty(navigator, 'userAgentData', {
          configurable: true,
          value: {
            platform: 'Windows',
            getHighEntropyValues: async () => ({ platformVersion: '13.0.0' }),
          },
        });
      }, source);
      const player = await openPlayer(page);
      await expect(capsule(page)).toHaveCSS('opacity', '1');
      await expect(capsule(page)).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.1)');
      await expect.poll(() => alphaOf(page)).toBeCloseTo(0.45, 2);
      await enterSettings(page);
      await page.getByRole('combobox', { name: '窗口背景', exact: true }).click();
      await page.getByRole('option', { name: 'Mica', exact: true }).click();
      await expect(capsule(page)).toHaveCSS('backdrop-filter', 'none');
      await expect.poll(() => alphaOf(page)).toBe(1);
      const events: unknown = await page.evaluate(() =>
        Reflect.get(window, '__capsuleTransitions'),
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'background-color', duration: 167 }),
          expect.objectContaining({ property: 'backdrop-filter', duration: 167 }),
        ]),
      );
      expect(player.errors).toEqual([]);
    });
  }
}

test('胶囊淡出期间保留节点并交接焦点，中途重开不会被旧退场卸载', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await choosePlayerBar(page, 'capsule');
  await watchTransitions(page);
  const player = await openPlayer(page, { harness: true });
  await expect(capsule(page)).toHaveCSS('opacity', '1');
  await capsule(page).locator('[data-player-key="next"]').focus();
  await capsule(page).evaluate((element) => {
    Reflect.set(window, '__oldCapsule', element);
    Reflect.set(window, '__pauseCapsuleExit', true);
  });
  await switchPreference(page, 'player-bar', 'bottom');
  await expect(capsule(page)).toHaveAttribute('inert');
  await expect(capsule(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('[data-player-bar] [data-player-key="next"]')).toBeFocused();
  await expect
    .poll(() =>
      capsule(page).evaluate((element) =>
        element.getAnimations().some((animation) => animation.playState === 'paused'),
      ),
    )
    .toBe(true);
  await switchPreference(page, 'player-bar', 'capsule');
  await expect(capsule(page)).not.toHaveAttribute('inert');
  await expect(capsule(page)).toHaveCSS('opacity', '1');
  expect(
    await capsule(page).evaluate((element) => Reflect.get(window, '__oldCapsule') === element),
  ).toBe(true);
  await page.evaluate(() => Reflect.set(window, '__pauseCapsuleExit', false));
  await capsule(page).locator('[data-player-key="cover"]').focus();
  player.state.state = 'stopped';
  player.state.track = null;
  await player.host.emit('playback:stopped', { reason: 'user' });
  await expect(capsule(page)).toHaveCount(0);
  await expect(page.locator('header [data-menu="main"]')).toBeFocused();
  player.state.state = 'playing';
  player.state.track = PLAYING_TRACK;
  await player.host.emit('playback:trackChanged', PLAYING_TRACK);
  await expect(capsule(page)).toHaveCSS('opacity', '1');
  const events: unknown = await page.evaluate(() => Reflect.get(window, '__capsuleTransitions'));
  expect(events).toEqual(
    expect.arrayContaining([
      { property: 'opacity', entering: true, duration: 83 },
      { property: 'opacity', entering: false, duration: 83 },
    ]),
  );
  expect(player.errors).toEqual([]);
});

test('减弱动效下胶囊迅速完成退场与重开，不遗留禁用节点', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choosePlayerBar(page, 'capsule');
  const player = await openPlayer(page, { harness: true });
  await expect(capsule(page)).toHaveCSS('opacity', '1');
  expect(
    await capsule(page).evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0.001s, 0.001s, 0.001s, 0.001s');
  await switchPreference(page, 'player-bar', 'bottom');
  await expect(capsule(page)).toHaveCount(0);
  await switchPreference(page, 'player-bar', 'capsule');
  await expect(capsule(page)).toHaveCSS('opacity', '1');
  await expect(capsule(page)).not.toHaveAttribute('inert');
  expect(player.errors).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`胶囊只有模糊开关，主视图参数互不影响且跨刷新保留：${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await choosePlayerBar(page, 'capsule');
    await page.addInitScript(() => {
      localStorage.setItem(
        'default-theme.window-background.v1',
        JSON.stringify({ source: 'cover' }),
      );
      if (!localStorage.getItem('default-theme.background-appearance.v1')) {
        localStorage.setItem(
          'default-theme.background-appearance.v1',
          JSON.stringify({
            light: { capsule: 98 },
            dark: { capsule: 98 },
          }),
        );
      }
    });
    const player = await openPlayer(page);
    await enterSettings(page);
    const expand = async (title: string) => {
      const toggle = page.getByRole('button', { name: title, exact: true });
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    };
    await expand('窗口背景');
    await expect(page.getByRole('slider', { name: '胶囊播放栏不透明度', exact: true })).toHaveCount(
      0,
    );
    await page.getByRole('slider', { name: '磨砂模糊', exact: true }).press('End');
    await page.getByRole('slider', { name: '磨砂颗粒', exact: true }).press('Home');
    const pane = capsule(page).locator('..').locator('[data-reading-fill]');
    await expect(pane).toHaveCSS('backdrop-filter', 'blur(60px) saturate(1.1)');
    await expect(capsule(page)).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.1)');
    await expect.poll(() => alphaOf(page)).toBeCloseTo(0.45, 2);
    expect(await capsule(page).evaluate((node) => getComputedStyle(node, '::before').opacity)).toBe(
      '0.02',
    );
    await expand('播放栏位置');
    const blur = page.getByRole('switch', { name: '胶囊背景模糊', exact: true });
    await expect(blur).toBeChecked();
    await blur.uncheck();
    await expect(capsule(page)).toHaveCSS('backdrop-filter', 'none');
    await expect.poll(() => alphaOf(page)).toBe(1);
    await expect(pane).toHaveCSS('backdrop-filter', 'blur(60px) saturate(1.1)');
    await page.reload();
    await enterSettings(page);
    await expand('播放栏位置');
    await expect(blur).not.toBeChecked();
    await expect(capsule(page)).toHaveCSS('backdrop-filter', 'none');
    await blur.check();
    await expect(capsule(page)).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.1)');
    await expect.poll(() => alphaOf(page)).toBeCloseTo(0.45, 2);
    await expect(pane).toHaveCSS('backdrop-filter', 'blur(60px) saturate(1.1)');
    expect(
      await page.evaluate((mode) => {
        const raw = localStorage.getItem('default-theme.background-appearance.v1');
        if (!raw) return null;
        const saved: unknown = JSON.parse(raw);
        if (!saved || typeof saved !== 'object') return null;
        const values: unknown = Reflect.get(saved, mode);
        return values && typeof values === 'object' ? Reflect.get(values, 'capsule') : null;
      }, scheme),
    ).toBe(98);
    expect(player.errors).toEqual([]);
  });
}
