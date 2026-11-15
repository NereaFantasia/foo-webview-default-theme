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
  const settings = await openSettings(page, {}, '沉浸视图');
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
  const settings = await openSettings(page, {}, '沉浸视图');
  // 缺省是图纸。视图背景属于「背景与性能」一节，排在视图样式自己的项之后
  await expectOption(page, '视图样式', '图纸');
  await expectOrder(settings, ['视图样式', '进入时全屏', '波形显示方式', '视图背景', '性能']);
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
    '进入时显示的页签',
    '歌词外观',
    '视图背景',
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
  const settings = await openSettings(page, {}, '沉浸视图');
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
  const settings = await openSettings(page, {}, '沉浸视图');
  await chooseScene(page, settings, '歌词');
  await expect(settings.radios('视图背景')).toHaveCount(1);
  for (const role of ['combobox', 'radiogroup'] as const) {
    await expect(
      page.locator('#settings-immersive').getByRole(role, { name: '背景', exact: true }),
    ).toHaveCount(0);
  }
});

test('歌词外观一张卡：跳到「歌词」那一组，焦点落在它的标题上', async ({ page }) => {
  const settings = await openSettings(page, {}, '沉浸视图');
  await chooseScene(page, settings, '歌词');
  await page.getByRole('button', { name: /前往歌词设置/ }).click();
  await expect(page.locator('#settings-lyrics h2')).toBeFocused();
  expect(settings.errors).toEqual([]);
});

test('背景选项：按所选渲染器列行，纯色时整张卡不出；改动即存，刷新后还在，恢复默认只清所选渲染器', async ({
  page,
}) => {
  const settings = await openSettings(page, {}, '沉浸视图');
  await chooseScene(page, settings, '歌词');
  const slider = (name: string) => page.getByRole('slider', { name, exact: true });
  const toggle = (name: string) => page.getByRole('switch', { name, exact: true });
  const stored = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('default-theme.immersive.backdropOptions.v1') ?? 'null'),
    );

  // 缺省是网格渐变：流动速度与随音乐律动
  await expect(settings.card('背景选项')).toBeVisible();
  await settings.expand('背景选项');
  await expect(slider('流动速度')).toHaveValue('100');
  await expect(slider('颗粒')).toHaveCount(0);
  await expect(toggle('光波')).toHaveCount(0);
  await expect(toggle('随音乐律动')).not.toBeChecked();
  await toggle('随音乐律动').check();
  await expect.poll(stored).toEqual({ mesh: { audio: true } });

  // 钛金属：四个材质滑块、流动速度、纹路移动时长、随音乐律动、减轻色带与取色方式
  await settings.choose('视图背景', '钛金属');
  for (const name of ['颗粒', '闪粉', '高光', '金属度', '流动速度', '纹路移动时长']) {
    await expect(slider(name)).toBeVisible();
  }
  await expect(slider('颗粒')).toHaveValue('70');
  await expect(slider('纹路移动时长')).toHaveValue('2000');
  await expect(toggle('减轻色带')).toBeChecked();
  await expect(settings.select('取色方式')).toHaveText('自动');
  await expect(toggle('光波')).toHaveCount(0);
  // 随音乐律动每个渲染器各存各的：网格渐变开了，钛金属仍是关
  await expect(toggle('随音乐律动')).not.toBeChecked();

  await slider('颗粒').focus();
  await slider('颗粒').press('Home');
  await toggle('随音乐律动').check();
  await toggle('减轻色带').uncheck();
  await settings.choose('取色方式', '八叉树');
  await slider('流动速度').focus();
  await slider('流动速度').press('End');
  await expect.poll(stored).toEqual({
    flowSpeed: 200,
    titanium: { grain: 0, audio: true, dithering: false, palette: 'octree' },
    mesh: { audio: true },
  });

  // 流动速度三种渲染器共用，别的项各记各的；隔离的低频音量是空实现，不放随音乐律动
  await settings.choose('视图背景', '隔离');
  await expect(slider('颗粒')).toHaveCount(0);
  await expect(toggle('随音乐律动')).toHaveCount(0);
  await expect(slider('流动速度')).toHaveValue('200');
  await expect(toggle('光波')).not.toBeChecked();
  await expect(toggle('减轻色带')).toBeChecked();
  await expect(settings.select('取色方式')).toHaveText('自动');
  await toggle('光波').check();
  await expect.poll(stored).toMatchObject({ isolation: { lightWave: true } });

  await page.reload();
  await enterSettings(page);
  await settings.expand('背景选项');
  await expectOption(page, '视图背景', '隔离');
  await expect(slider('流动速度')).toHaveValue('200');
  await expect(toggle('光波')).toBeChecked();

  // 恢复默认只清所选的隔离，连同共用的流动速度；钛金属的项留着
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(slider('流动速度')).toHaveValue('100');
  await expect(toggle('光波')).not.toBeChecked();
  await expect.poll(stored).toEqual({
    titanium: { grain: 0, audio: true, dithering: false, palette: 'octree' },
    mesh: { audio: true },
  });
  await settings.choose('视图背景', '钛金属');
  await expect(slider('颗粒')).toHaveValue('0');
  await expect(toggle('随音乐律动')).toBeChecked();

  // 纯色：整张卡不出
  await settings.choose('视图背景', '纯色');
  await expect(settings.card('背景选项')).toHaveCount(0);
  expect(settings.errors).toEqual([]);
});

test('背景选项在图纸样式里不出现', async ({ page }) => {
  const settings = await openSettings(page, {}, '沉浸视图');
  await expectOption(page, '视图样式', '图纸');
  await expect(settings.card('背景选项')).toHaveCount(0);
});
