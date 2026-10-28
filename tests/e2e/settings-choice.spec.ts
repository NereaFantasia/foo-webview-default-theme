import { expect, test, type Page } from '@playwright/test';
import {
  backgroundCard,
  backgroundSources,
  chooseBackground,
  expectBackground,
  openBackground,
  openSettings,
} from '../fixtures/settingsPage.ts';

// 设置页的缩略图单选与图标分段：选中即生效、方向键换项、状态随偏好走。

const PLAYER_BAR_KEY = 'default-theme.player-bar.v1';
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), PLAYER_BAR_KEY);

test('播放栏位置：缩略图单选选中即生效，胶囊背景模糊只在标题栏与胶囊时出现', async ({ page }) => {
  const settings = await openSettings(page);
  const group = settings.radios('播放栏位置');
  const card = settings.card('播放栏位置');
  await expect(group.getByRole('radio')).toHaveCount(3);
  await expect(group.getByRole('radio', { name: '窗口底部' })).toBeChecked();
  await expect(card.getByText('胶囊背景模糊', { exact: true })).toHaveCount(0);

  await settings.choose('播放栏位置', '胶囊');
  await expect(group.getByRole('radio', { name: '胶囊' })).toBeChecked();
  await expect.poll(() => stored(page)).toBe('capsule');
  await expect(card.getByText('胶囊背景模糊', { exact: true })).toBeVisible();

  await settings.choose('播放栏位置', '窗口底部');
  await expect.poll(() => stored(page)).toBe('bottom');
  await expect(card.getByText('胶囊背景模糊', { exact: true })).toHaveCount(0);
});

test('播放栏位置：方向键在三张缩略图之间换，点缩略图与点单选一样', async ({ page }) => {
  const settings = await openSettings(page);
  const group = settings.radios('播放栏位置');
  await group.getByRole('radio', { name: '窗口底部' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: '标题栏' })).toBeChecked();
  await expect.poll(() => stored(page)).toBe('titlebar');
  // 缩略图是单选的 label：点它换到第三项
  await group.locator('label[aria-hidden]').nth(2).click();
  await expect(group.getByRole('radio', { name: '胶囊' })).toBeChecked();
});

test('颜色模式：三张缩略图，选中即生效，跟随系统时说明行写当前一档', async ({ page }) => {
  const settings = await openSettings(page);
  const group = settings.radios('颜色模式');
  await expect(group.getByRole('radio')).toHaveCount(3);
  await expect(group.getByRole('radio', { name: '跟随系统' })).toBeChecked();
  await expect(settings.card('颜色模式')).toContainText('当前：');
  await settings.choose('颜色模式', '深色');
  await expect(group.getByRole('radio', { name: '深色' })).toBeChecked();
  await expect(settings.card('颜色模式')).not.toContainText('当前：');
});

/** 缩略图方框与里面的播放键，各取中心。 */
async function playThumbCenters(page: Page) {
  return page.locator('[data-play-thumb]').evaluateAll((buttons) =>
    buttons.map((button) => {
      const frame = button.closest('label');
      if (!frame) throw new Error('播放键不在缩略图里');
      const inner = button.getBoundingClientRect();
      const outer = frame.getBoundingClientRect();
      return {
        x: inner.left + inner.width / 2 - (outer.left + outer.width / 2),
        y: inner.top + inner.height / 2 - (outer.top + outer.height / 2),
      };
    }),
  );
}

test('主播放按钮：五张缩略图，选中即生效，播放键在缩略图正中，窄卡也是', async ({ page }) => {
  const settings = await openSettings(page);
  await settings.expand('强调色');
  const group = settings.radios('主播放按钮');
  await expect(group.getByRole('radio')).toHaveCount(5);
  await settings.choose('主播放按钮', '原色');
  await expect(group.getByRole('radio', { name: '原色' })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('default-theme.play-button-style.v1')))
    .toBe('raw');
  for (const offset of await playThumbCenters(page)) {
    expect(Math.abs(offset.x)).toBeLessThan(0.5);
    expect(Math.abs(offset.y)).toBeLessThan(0.5);
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await settings.expand('强调色');
  const offsets = await playThumbCenters(page);
  expect(offsets).toHaveLength(5);
  for (const offset of offsets) expect(Math.abs(offset.x)).toBeLessThan(0.5);
});

test('窄卡：缩略图最多三列，多出的折行', async ({ page }) => {
  const settings = await openSettings(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await settings.expand('强调色');
  const tops = await settings
    .radios('主播放按钮')
    .locator('label[aria-hidden]')
    .evaluateAll((labels) => labels.map((label) => Math.round(label.getBoundingClientRect().top)));
  expect(tops).toHaveLength(5);
  expect(new Set(tops.slice(0, 3)).size).toBe(1);
  expect(tops[3]).toBeGreaterThan(tops[0] ?? 0);
  expect(tops[3]).toBe(tops[4]);
});

test('基础强调色：宽卡是图标分段，窄卡换成单选，选中的一项在两种形态里一致', async ({ page }) => {
  const settings = await openSettings(page);
  await settings.expand('强调色');
  const tabs = page.getByRole('tablist', { name: '基础强调色', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: '默认青绿' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await settings.choose('基础强调色', '自定义颜色');
  await expect(tabs.getByRole('tab', { name: '自定义颜色' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.setViewportSize({ width: 390, height: 800 });
  const radios = settings.radios('基础强调色');
  await expect(radios.getByRole('radio')).toHaveCount(3);
  await expect(radios.getByRole('radio', { name: '自定义颜色' })).toBeChecked();
});

const BACKGROUND_KEY = 'default-theme.window-background.v1';
const BACKDROP_KEY = 'default-theme.backdrop.v1';
const storedSource = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { source?: string }).source : null;
  }, BACKGROUND_KEY);

test('窗口背景：缺省收起，卡头有当前来源的小缩略图；展开是来源五选一', async ({ page }) => {
  await openSettings(page);
  const card = backgroundCard(page);
  await expect(card.locator('[data-settings-toggle]')).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('[data-tile]')).toHaveCount(1);
  await openBackground(page);
  await expect(backgroundSources(page).getByRole('radio')).toHaveCount(5);
  await expect(card.locator('[data-tile]')).toHaveCount(6);
});

test('窗口背景：封面、色场、图片只换来源，材质留着；主题色回系统材质时回到跟随首选项', async ({
  page,
}) => {
  const settings = await openSettings(page);
  await chooseBackground(page, 'Mica');
  await expectBackground(page, 'Mica');

  await chooseBackground(page, '正在播放的封面');
  await expect.poll(() => storedSource(page)).toBe('cover');
  await expect(page.getByRole('tablist', { name: '材质', exact: true })).toHaveCount(0);
  await chooseBackground(page, '系统材质');
  await expectBackground(page, 'Mica');
  await expect.poll(() => storedSource(page)).toBe('material');

  await chooseBackground(page, '主题色背景');
  await expect(page.getByRole('tablist', { name: '材质', exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), BACKDROP_KEY))
    .toBe('none');
  await chooseBackground(page, '系统材质');
  await expectBackground(page, '跟随 foobar2000 首选项');
  expect(settings.errors).toEqual([]);
});

test('窗口背景：窄卡里材质一行换成单选', async ({ page }) => {
  await openSettings(page);
  await chooseBackground(page, '系统材质');
  await page.setViewportSize({ width: 390, height: 800 });
  const radios = page.getByRole('radiogroup', { name: '材质', exact: true });
  await expect(radios.getByRole('radio')).toHaveCount(4);
  await expect(radios.getByRole('radio', { name: '跟随 foobar2000 首选项' })).toBeChecked();
});

const IMMERSIVE_KEYS = {
  scene: 'default-theme.immersive.scene.v1',
  backdrop: 'default-theme.immersive.backdrop.v1',
  startPage: 'default-theme.immersive.startPage.v1',
  waveform: 'default-theme.immersive.waveformMode.v1',
} as const;
const storedImmersive = (page: Page, key: string) =>
  page.evaluate((name) => localStorage.getItem(name), key);

test('沉浸视图：视图样式与波形显示方式是缩略图单选，选中即生效', async ({ page }) => {
  const settings = await openSettings(page);
  const scenes = settings.radios('视图样式');
  await expect(scenes.getByRole('radio')).toHaveCount(2);
  await expect(scenes.getByRole('radio', { name: '图纸' })).toBeChecked();
  const waves = settings.radios('波形显示方式');
  await expect(waves.getByRole('radio')).toHaveCount(5);
  await settings.choose('波形显示方式', '三频叠加');
  await expect(waves.getByRole('radio', { name: '三频叠加' })).toBeChecked();
  await expect.poll(() => storedImmersive(page, IMMERSIVE_KEYS.waveform)).toBe('layers');

  await settings.choose('视图样式', '歌词');
  await expect.poll(() => storedImmersive(page, IMMERSIVE_KEYS.scene)).toBe('presets');
  await expect(settings.card('波形显示方式')).toHaveCount(0);
});

test('沉浸视图：歌词样式的视图背景是四张缩略图，进入时显示的页签是图标分段', async ({ page }) => {
  const settings = await openSettings(page);
  await settings.choose('视图样式', '歌词');
  const backdrops = settings.radios('视图背景');
  await expect(backdrops.getByRole('radio')).toHaveCount(4);
  await expect(backdrops.getByRole('radio', { name: '网格渐变' })).toBeChecked();
  await settings.choose('视图背景', '隔离');
  await expect(backdrops.getByRole('radio', { name: '隔离' })).toBeChecked();
  await expect.poll(() => storedImmersive(page, IMMERSIVE_KEYS.backdrop)).toBe('isolation');

  const tabs = page.getByRole('tablist', { name: '进入时显示的页签', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: '歌词' })).toHaveAttribute('aria-selected', 'true');
  await settings.choose('进入时显示的页签', '历史');
  await expect(tabs.getByRole('tab', { name: '历史' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => storedImmersive(page, IMMERSIVE_KEYS.startPage)).toBe('history');
  await page.setViewportSize({ width: 390, height: 800 });
  const radios = settings.radios('进入时显示的页签');
  await expect(radios.getByRole('radio')).toHaveCount(3);
  await expect(radios.getByRole('radio', { name: '历史' })).toBeChecked();
  expect(settings.errors).toEqual([]);
});

test('歌词：文字对齐是图标分段，当前行位置是三张缩略图，对齐位置在同一张卡的底部', async ({
  page,
}) => {
  const settings = await openSettings(page);
  const tabs = page.getByRole('tablist', { name: '文字对齐', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: '居左' })).toHaveAttribute('aria-selected', 'true');
  await settings.choose('文字对齐', '居中');
  await expect(tabs.getByRole('tab', { name: '居中' })).toHaveAttribute('aria-selected', 'true');

  const anchors = settings.radios('当前行位置');
  await expect(anchors.getByRole('radio')).toHaveCount(3);
  await expect(anchors.getByRole('radio', { name: '中部' })).toBeChecked();
  await settings.choose('当前行位置', '底部');
  await expect(anchors.getByRole('radio', { name: '底部' })).toBeChecked();
  await expect(
    settings.card('当前行位置').getByRole('spinbutton', { name: '对齐位置 (%)' }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('radiogroup', { name: '文字对齐', exact: true })).toBeVisible();
  expect(settings.errors).toEqual([]);
});

test('桌面歌词：背景与配色是缩略图，字号与对齐是图标分段', async ({ page }) => {
  const settings = await openSettings(page);
  await settings.expand('桌面歌词');
  const backgrounds = settings.radios('背景');
  await expect(backgrounds.getByRole('radio')).toHaveCount(2);
  await expect(backgrounds.getByRole('radio', { name: '底板' })).toBeChecked();
  const palettes = settings.radios('配色');
  await expect(palettes.getByRole('radio')).toHaveCount(3);
  await expect(palettes.getByRole('radio', { name: '跟随主题与封面' })).toBeChecked();
  await settings.choose('配色', '自定义');
  await expect(palettes.getByRole('radio', { name: '自定义' })).toBeChecked();
  await settings.choose('背景', '透明');
  await expect(backgrounds.getByRole('radio', { name: '透明' })).toBeChecked();

  const sizes = page.getByRole('tablist', { name: '字号', exact: true });
  await expect(sizes.getByRole('tab')).toHaveCount(4);
  await settings.choose('字号', '大');
  await expect(sizes.getByRole('tab', { name: '大', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const aligns = page.getByRole('tablist', { name: '对齐', exact: true });
  await expect(aligns.getByRole('tab')).toHaveCount(3);
  expect(settings.errors).toEqual([]);
});

test('启动时打开：宽卡是六项图标分段，窄卡换成两列三行的单选', async ({ page }) => {
  const settings = await openSettings(page);
  const tabs = page.getByRole('tablist', { name: '启动时打开', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(6);
  await expect(tabs.getByRole('tab', { name: '专辑' })).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 390, height: 800 });
  const radios = settings.radios('启动时打开');
  await expect(radios.getByRole('radio')).toHaveCount(6);
  await expect(radios.getByRole('radio', { name: '专辑' })).toBeChecked();
  const tops = await radios
    .locator('label[aria-hidden]')
    .evaluateAll((labels) => labels.map((label) => Math.round(label.getBoundingClientRect().top)));
  expect(tops).toHaveLength(6);
  expect(new Set(tops).size).toBe(3);
  await settings.choose('启动时打开', '流派');
  await expect(radios.getByRole('radio', { name: '流派' })).toBeChecked();
});
