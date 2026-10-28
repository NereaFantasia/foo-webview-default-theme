import { expect, test, type Page } from '@playwright/test';
import {
  expectOption,
  openSettings,
  enterSettings,
  type SettingsPage,
} from '../fixtures/settingsPage.ts';

/** 这几张卡在页面上自上而下的先后：量上沿，不靠 DOM 顺序 */
async function expectOrder(settings: SettingsPage, titles: readonly string[]): Promise<void> {
  const tops: number[] = [];
  for (const title of titles) {
    const box = await settings.card(title).first().boundingBox();
    if (!box) throw new Error(`${title} 这张卡没有框`);
    tops.push(box.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
}

async function chooseScene(page: Page, settings: SettingsPage, option: '歌词' | '图纸') {
  await settings.choose('视图样式', option);
}

test('进入设置先读沉浸偏好，修改可保存且不启动可视化服务', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('default-theme.immersive.wash.v1') === null) {
      localStorage.setItem('default-theme.immersive.wash.v1', 'static');
      localStorage.setItem('default-theme.immersive.fpsCap.v1', '60');
    }
  });
  const settings = await openSettings(page);
  await expect(page.getByRole('switch', { name: '进入时全屏', exact: true })).toBeVisible();
  await settings.expand('视图背景');
  await expect(settings.select('封面底色')).toHaveText('静态');
  await settings.choose('封面底色', '不显示');
  await settings.expand('性能');
  await expect(settings.select('帧率上限')).toHaveText('60 fps');
  await settings.choose('帧率上限', '30 fps');
  await page.getByRole('switch', { name: '性能小窗', exact: true }).check();
  for (const method of [
    'audio.subscribeSpectrum',
    'audio.subscribeStream',
    'audio.generateFullWaveform',
    'window.setFullscreen',
  ] as const)
    expect(settings.host.callsTo(method)).toEqual([]);
  await page.reload();
  await enterSettings(page);
  await settings.expand('视图背景');
  await settings.expand('性能');
  await expect(settings.select('封面底色')).toHaveText('不显示');
  await expect(settings.select('帧率上限')).toHaveText('30 fps');
  await expect(page.getByRole('switch', { name: '性能小窗', exact: true })).toBeChecked();
  expect(settings.errors).toEqual([]);
});

test('所选视图样式自己的项才显示：图纸是视图背景展开卡与波形，歌词是背景缩略图、页签与歌词外观', async ({
  page,
}) => {
  const settings = await openSettings(page);
  // 缺省是图纸
  await expectOption(page, '视图样式', '图纸');
  await expectOrder(settings, ['视图样式', '进入时全屏', '视图背景', '波形显示方式', '性能']);
  await settings.expand('视图背景');
  await expect(settings.select('封面底色')).toBeVisible();
  await expect(page.getByRole('switch', { name: '背景山脊图', exact: true })).toBeVisible();
  await expect(settings.card('进入时显示的页签')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /前往歌词设置/ })).toHaveCount(0);

  // 改成歌词：图纸的项收起，歌词的项出来；视图背景变成一组缩略图单选，叫法不变
  await chooseScene(page, settings, '歌词');
  await expectOrder(settings, [
    '视图样式',
    '进入时全屏',
    '视图背景',
    '进入时显示的页签',
    '歌词外观',
    '性能',
  ]);
  await expectOption(page, '视图背景', '网格渐变');
  await expectOption(page, '进入时显示的页签', '歌词');
  await expect(settings.select('封面底色')).toHaveCount(0);
  await expect(settings.card('波形显示方式')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: '背景山脊图', exact: true })).toHaveCount(0);

  // 再改回图纸
  await chooseScene(page, settings, '图纸');
  await expect(settings.card('波形显示方式')).toBeVisible();
  await expect(settings.card('进入时显示的页签')).toHaveCount(0);
  expect(settings.errors).toEqual([]);
});

test('歌词样式的视图背景与进入时显示的页签：修改后保存，重载仍在', async ({ page }) => {
  const settings = await openSettings(page);
  await chooseScene(page, settings, '歌词');
  await settings.choose('视图背景', '钛金属');
  await settings.choose('进入时显示的页签', '队列');
  expect(
    await page.evaluate(() => [
      localStorage.getItem('default-theme.immersive.backdrop.v1'),
      localStorage.getItem('default-theme.immersive.startPage.v1'),
    ]),
  ).toEqual(['titanium', 'queue']);
  await page.reload();
  await enterSettings(page);
  await expectOption(page, '视图样式', '歌词');
  await expectOption(page, '视图背景', '钛金属');
  await expectOption(page, '进入时显示的页签', '队列');
  await settings.choose('视图背景', '纯色');
  expect(
    await page.evaluate(() => localStorage.getItem('default-theme.immersive.backdrop.v1')),
  ).toBe('off');
  expect(settings.errors).toEqual([]);
});

test('沉浸视图组里没有叫「背景」的项：与歌词组里桌面歌词的「背景」分得开', async ({ page }) => {
  const settings = await openSettings(page);
  await chooseScene(page, settings, '歌词');
  await expect(settings.radios('视图背景')).toHaveCount(1);
  for (const role of ['combobox', 'radiogroup'] as const) {
    await expect(
      page.locator('#settings-immersive').getByRole(role, { name: '背景', exact: true }),
    ).toHaveCount(0);
  }
});

test('歌词外观一张卡：跳到「歌词」那一组，焦点落在它的标题上', async ({ page }) => {
  const settings = await openSettings(page);
  await chooseScene(page, settings, '歌词');
  await page.getByRole('button', { name: /前往歌词设置/ }).click();
  await expect(page.locator('#settings-lyrics h2')).toBeFocused();
  expect(settings.errors).toEqual([]);
});
