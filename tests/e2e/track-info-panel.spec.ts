import { expect, test, type Page } from '@playwright/test';
import { installPageHost, collectPageErrors } from '../fixtures/pageHost.ts';
import { answerTrackInfo, INFO_TAGS } from '../fixtures/trackInfoAnswers.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

async function open(page: Page) {
  const host = await installPageHost(page);
  answerTrackInfo(host);
  await page.goto('/tests/fixtures/trackInfoHarness.html');
  await expect(page.getByText('44.1 kHz', { exact: true })).toBeVisible();
  return host;
}

async function change(page: Page, method: string, value: unknown) {
  await page.evaluate(
    ({ method, value }) => {
      const harness: unknown = Reflect.get(window, '__trackInfoHarness');
      if (!harness || typeof harness !== 'object') throw new Error('没有信息验证入口');
      const action: unknown = Reflect.get(harness, method);
      if (typeof action !== 'function') throw new Error('没有验证操作');
      action(value);
    },
    { method, value },
  );
}

test('默认分组、原始标签搜索、复制与从文件刷新', async ({ page }) => {
  const host = await open(page);
  await expect(page.getByRole('button', { name: '元数据', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(host.callsTo('file.getInfo')).toEqual([]);
  await page.getByRole('button', { name: '全部标签', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索字段名或值' });
  await search.fill('CustomMixedCase');
  await expect(page.getByText('CustomMixedCase', { exact: true })).toBeVisible();
  await expect(page.getByText('one', { exact: true })).toBeVisible();
  const raw = page
    .locator('dl > div')
    .filter({ has: page.getByText('CustomMixedCase', { exact: true }) });
  await raw.hover();
  await raw.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.getByText('已复制', { exact: true })).toBeVisible();
  expect(JSON.parse(String(host.callsTo('clipboard.write').at(-1)?.['text']))).toEqual({
    CustomMixedCase: ['one', 'two'],
  });
  await search.fill('Cise');
  await expect(page.getByText('Cise Starr, Akin', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '从文件重新读取', exact: true }).click();
  await expect(page.getByText('来源：文件', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('Cise');
});

test('文件、播放记录和 ReplayGain 按需读取；预览切换不发起播放', async ({ page }) => {
  const host = await open(page);
  await page.getByRole('button', { name: '文件与位置', exact: true }).click();
  await expect(page.getByText('19.07 MiB')).toBeVisible();
  await page.getByRole('button', { name: '打开所在文件夹' }).click();
  expect(host.callsTo('shell.showInExplorer').at(-1)?.['path']).not.toContain('|subsong:');
  await page.getByRole('button', { name: '播放记录', exact: true }).click();
  await expect(page.getByText('来源：Playback Statistics（foo_playcount）')).toBeVisible();
  await page.getByRole('button', { name: 'ReplayGain', exact: true }).click();
  await expect(page.getByText('-7.25 dB', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览曲目', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回正在播放', exact: false })).toBeVisible();
  await change(page, 'play', { title: '现在播放另一首', path: 'file://E:/next.flac' });
  await expect(page.getByRole('button', { name: '返回正在播放 现在播放另一首' })).toBeVisible();
  await page.getByRole('button', { name: '返回正在播放 现在播放另一首' }).click();
  await expect(page.getByRole('button', { name: '信息来源' })).toHaveText('正在播放');
  await expect(page.getByRole('button', { name: '返回正在播放', exact: false })).toHaveCount(0);
  expect(host.callsTo('playback.play')).toEqual([]);
  expect(host.callsTo('playlist.playTrack')).toEqual([]);
});

test('无标签、读取失败和统计缺席分别显示，不展示伪造数据', async ({ page }) => {
  const host = await open(page);
  host.answer('metadata.read', {
    success: true,
    path: '',
    tags: {},
    info: { duration: 0, bitrate: 0, sampleRate: 0, channels: 0, codec: '' },
  });
  host.answer('config.getComponents', { success: true, count: 0, components: [] });
  await change(page, 'select', { path: 'file://E:/07 Unknown.flac', title: '' });
  await expect(page.getByText('07 Unknown', { exact: true })).toBeVisible();
  await expect(page.getByText('未填写', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '全部标签', exact: true }).click();
  await expect(page.getByText('没有标签', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '播放记录', exact: true }).click();
  await expect(page.getByText('播放统计不可用', { exact: true })).toBeVisible();
  host.answer('metadata.readRaw', hostFailure('OPERATION_FAILED'));
  await page.getByRole('button', { name: '从文件重新读取', exact: true }).click();
  await expect(page.getByText('无法读取此项信息', { exact: true }).first()).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme}：复制键按需显示；文字与箭头可折叠，标题空白不响应`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const host = await open(page);
    const row = page
      .locator('dl > div')
      .filter({ has: page.locator('dt').getByText('艺人', { exact: true }) });
    const button = row.getByRole('button', { name: '复制', exact: true });
    const reveal = button.locator('..');
    await page.mouse.move(0, 0);
    await expect(reveal).toHaveCSS('opacity', '0');
    const before = await row.boundingBox();
    await row.hover();
    await expect(reveal).toHaveCSS('opacity', '1');
    expect(await row.boundingBox()).toEqual(before);
    await button.click();
    expect(host.callsTo('clipboard.write').at(-1)?.['text']).toBe('Nujabes\nCise Starr, Akin');
    await page.mouse.move(0, 0);
    await expect(reveal).toHaveCSS('opacity', '1');
    await button.blur();
    await expect(reveal).toHaveCSS('opacity', '0');
    const missing = page
      .locator('dl > div')
      .filter({ has: page.getByText('总碟数', { exact: true }) });
    await missing.hover();
    await expect(missing.getByRole('button', { name: '复制', exact: true })).toBeDisabled();
    const heading = page.getByRole('button', { name: '元数据', exact: true });
    const fullHeader = heading.locator('..');
    const bounds = await fullHeader.boundingBox();
    if (!bounds) throw new Error('分组标题缺失');
    await fullHeader.click({ position: { x: bounds.width - 3, y: bounds.height / 2 } });
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await heading.locator('svg').click();
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await heading.locator('svg').click();
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await heading.getByText('元数据', { exact: true }).click();
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await heading.focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    const file = page.getByRole('button', { name: '文件与位置', exact: true });
    await page.getByRole('button', { name: '面板选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '复制全部字段', exact: true }).click();
    await expect(page.getByText('已复制', { exact: true })).toBeVisible();
    expect(JSON.parse(String(host.callsTo('clipboard.write').at(-1)?.['text']))).toMatchObject({
      音频: { 采样率: '44.1 kHz' },
      播放记录: { 播放次数: '12' },
      全部标签: INFO_TAGS,
    });
    await expect(file).toHaveAttribute('aria-expanded', 'false');
  });

  test(`${colorScheme}：封面复用折叠动画，退场后恢复小图与焦点，支持减弱动效`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    const errors = collectPageErrors(page);
    await open(page);
    const head = page.locator('[data-track-info] > div').first();
    const toggle = head.locator('[data-info-cover-toggle]');
    const expanded = head.locator('[data-expanded]');
    await toggle.click();
    await expect(expanded).toHaveCount(1);
    expect(
      await expanded.evaluate((element) =>
        element.getAnimations().map((animation) => animation.effect?.getTiming().duration),
      ),
    ).toContain(333);
    await expect(toggle).toBeFocused();
    const exit = await expanded.evaluate(async (element) => {
      const button = element.querySelector('[data-info-cover-toggle]');
      if (!(button instanceof HTMLButtonElement)) throw new Error('封面开合键缺失');
      button.click();
      await new Promise(requestAnimationFrame);
      return {
        mounted: element.isConnected,
        durations: element
          .getAnimations()
          .map((animation) => animation.effect?.getTiming().duration),
      };
    });
    expect(exit).toEqual({ mounted: true, durations: [167] });
    await expect(expanded).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(head.locator('button').first()).toHaveCSS('width', '44px');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggle.click();
    await expect(expanded).toHaveCount(1);
    expect(
      await expanded.evaluate((element) =>
        element.getAnimations().map((animation) => animation.effect?.getTiming().duration),
      ),
    ).toEqual([1]);
    await toggle.click();
    await expect(expanded).toHaveCount(0);
    await expect(toggle).toBeFocused();
    expect(errors).toEqual([]);
  });

  for (const width of [1280, 390]) {
    test(`${colorScheme} ${width}：固定身份与返回栏，长字段不撑宽`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: width === 390 ? 900 : 800 });
      const host = await open(page);
      host.answer('metadata.read', {
        success: true,
        path: '',
        tags: { ...INFO_TAGS, TITLE: '很长的曲名'.repeat(20) },
        info: { duration: 175, bitrate: 900, sampleRate: 44100, channels: 2, codec: 'FLAC' },
      });
      await change(page, 'select', {
        title: '很长的曲名'.repeat(20),
        path: `file://E:/Music/${'long-folder-name/'.repeat(12)}track.flac`,
      });
      await page.getByRole('button', { name: '全部标签', exact: true }).click();
      await page.getByRole('button', { name: '文件与位置', exact: true }).click();
      await expect(page.getByText('19.07 MiB')).toBeVisible();
      const header = page.locator('[data-track-info] > div').first();
      const before = await header.boundingBox();
      await page
        .getByRole('button', { name: '复制全部标签', exact: true })
        .scrollIntoViewIfNeeded();
      expect(await header.boundingBox()).toEqual(before);
      await expect(page.getByRole('button', { name: '返回正在播放', exact: false })).toBeVisible();
      const overflow = await page
        .locator('[data-track-info]')
        .evaluate(
          (element) =>
            element.scrollWidth > element.clientWidth ||
            document.documentElement.scrollWidth > window.innerWidth,
        );
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
}
