import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ConfigOutputDevice } from 'foo-webview-sdk';
import {
  DEFAULT_DEVICE_ID,
  hostFailure,
  OUTPUT_MODULES,
  outputDevice,
} from '../fixtures/hostAnswers.ts';
import { choosePlayerBar, openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';

// 输出设备与音量的几处件：标题栏、胶囊与窄窗通栏的音量浮层（两栏，设备栏原地展开），宽窗通栏的输出设备键。设备列表按模块分组、当前设备标出、选了按两个 GUID 切换、
// 勾以宿主回读为准。对齐按像素断言；观感实机看。

const SPEAKERS = '{0000000D-0000-0000-0000-000000000001}';
const EXCLUSIVE = '{0000000D-0000-0000-0000-000000000002}';

/** 宿主那边的设备清单，第 `current` 个生效；切换时改它，回读就对得上。 */
function switchableDevices(player: PlayerPage): void {
  let current = 0;
  const rows = (): ConfigOutputDevice[] =>
    [
      outputDevice(OUTPUT_MODULES.directSound, DEFAULT_DEVICE_ID, 'Primary Sound Driver'),
      outputDevice(OUTPUT_MODULES.directSound, SPEAKERS, 'Speakers (Realtek(R) Audio)'),
      outputDevice(OUTPUT_MODULES.wasapi, EXCLUSIVE, 'Speakers (Realtek(R) Audio) [exclusive]'),
    ].map((row, at) => ({ ...row, isCurrent: at === current }));
  player.host.answer('config.getOutputDevices', () => {
    const devices = rows();
    return { success: true, devices, count: devices.length };
  });
  player.host.answer('config.setOutputDevice', (params) => {
    const at = rows().findIndex(
      (row) => row.outputId === params['outputId'] && row.deviceId === params['deviceId'],
    );
    if (at >= 0) current = at;
    return { success: true };
  });
}

/** 元素在页面里的左右缘与竖直中线，取整到像素。 */
function edgesOf(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: Math.round(box.left),
      right: Math.round(box.right),
      middle: Math.round(box.left + box.width / 2),
      top: Math.round(box.top),
      height: Math.round(box.height),
    };
  });
}

async function settled(locator: Locator): Promise<void> {
  await locator.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
}

const deviceRow = (page: Page, key: string) => page.locator(`[data-output-device="${key}"]`);

test('标题栏音量浮层的设备栏弹出分组列表：当前设备标出，选另一个按两个 GUID 切换，回读后设备栏跟着换', async ({
  page,
}) => {
  await choosePlayerBar(page, 'titlebar');
  const player = await openPlayer(page);
  switchableDevices(player);
  await page.locator('header [data-player-key="volume"]').click();
  const panel = page.locator('[data-volume-popover]');
  await settled(panel);
  const device = panel.locator('[data-player-key="output"]');
  await device.click();
  const list = panel.getByRole('group', { name: '输出设备', exact: true });
  await expect(list).toBeVisible();
  await expect(device).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByRole('group', { name: 'DirectSound' })).toBeVisible();
  await expect(list.getByRole('group', { name: 'WASAPI (shared)' })).toBeVisible();
  await expect(
    deviceRow(page, `${OUTPUT_MODULES.directSound}|${DEFAULT_DEVICE_ID}`),
  ).toHaveAttribute('aria-current', 'true');
  // 列表开着时指针离开，浮层照样开着。
  await page.mouse.move(640, 400);
  await page.waitForTimeout(700);
  await expect(panel).toBeVisible();

  await deviceRow(page, `${OUTPUT_MODULES.wasapi}|${EXCLUSIVE}`).click();
  await expect
    .poll(() => player.calls('config.setOutputDevice'))
    .toEqual([{ outputId: OUTPUT_MODULES.wasapi, deviceId: EXCLUSIVE }]);
  await expect(list).toHaveCount(0);
  await expect(device).toBeFocused();
  await expect(device).toContainText('Speakers (Realtek(R) Audio) [exclusive]');
  // 选完只收列表，浮层留着，等用户自己 Esc 或点别处
  await page.mouse.move(640, 400);
  await page.waitForTimeout(700);
  await expect(panel).toBeVisible();
  expect(player.errors).toEqual([]);
});

test('宿主没接受切换：列表留着、顶上写原因，勾不挪；下次打开时原因已收起', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  const player = await openPlayer(page);
  player.host.answer('config.setOutputDevice', hostFailure('OPERATION_FAILED'));
  await page.locator('header [data-player-key="volume"]').click();
  const panel = page.locator('[data-volume-popover]');
  await settled(panel);
  const device = panel.locator('[data-player-key="output"]');
  await device.click();
  const list = panel.getByRole('group', { name: '输出设备', exact: true });
  await deviceRow(page, `${OUTPUT_MODULES.wasapi}|${EXCLUSIVE}`).click();
  await expect(list.getByRole('alert')).toHaveText('切换输出设备失败');
  await expect(
    deviceRow(page, `${OUTPUT_MODULES.directSound}|${DEFAULT_DEVICE_ID}`),
  ).toHaveAttribute('aria-current', 'true');
  await device.click();
  await expect(list).toHaveCount(0);
  await device.click();
  await expect(list).toBeVisible();
  await expect(list.getByRole('alert')).toHaveCount(0);
  expect(player.errors).toEqual([]);
});

test('设备很多、当前设备排在中段：打开时当前设备滚到列表中间、拿到焦点，上下键在各行之间挪', async ({
  page,
}) => {
  await choosePlayerBar(page, 'titlebar');
  const player = await openPlayer(page);
  const many = Array.from({ length: 24 }, (_, at) =>
    outputDevice(
      OUTPUT_MODULES.wasapi,
      `{0000000E-0000-0000-0000-${String(at).padStart(12, '0')}}`,
      `Device ${String(at).padStart(2, '0')}`,
      at === 12,
    ),
  );
  player.host.answer('config.getOutputDevices', {
    success: true,
    devices: many,
    count: many.length,
  });
  await page.locator('header [data-player-key="volume"]').click();
  const panel = page.locator('[data-volume-popover]');
  await settled(panel);
  await panel.locator('[data-player-key="output"]').click();
  const list = panel.getByRole('group', { name: '输出设备', exact: true });
  const current = list.locator('[aria-current="true"]');
  await expect(current).toHaveText('Device 12');
  // 从设备栏点开时焦点还在设备栏上，列表只滚到位；走进列表后上下键才在各行之间挪
  const [box, row] = await Promise.all([edgesOf(list), edgesOf(current)]);
  const middle = box.top + box.height / 2;
  expect(Math.abs(row.top + row.height / 2 - middle)).toBeLessThanOrEqual(row.height);
  await current.focus();
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('button', { name: 'Device 13' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(list.getByRole('button', { name: 'Device 00' })).toBeFocused();
  expect(player.errors).toEqual([]);
});

test('设备列表开着时窗口跨过 1008：焦点跟到胶囊的音量键上，不掉到页面上', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  const { errors } = await openPlayer(page);
  await page.locator('header [data-player-key="volume"]').click();
  const panel = page.locator('[data-volume-popover]');
  await settled(panel);
  await panel.locator('[data-player-key="output"]').click();
  const list = panel.getByRole('group', { name: '输出设备', exact: true });
  await list.locator('[aria-current="true"]').focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('[data-player-capsule] [data-player-key="volume"]')).toBeFocused();
  expect(errors).toEqual([]);
});

test('设备列表开着按 Esc 收起整个浮层、焦点回到音量键', async ({ page }) => {
  await choosePlayerBar(page, 'titlebar');
  const { errors } = await openPlayer(page);
  const square = page.locator('header [data-player-key="volume"]');
  // 键盘走进音量键（在下一首键之后）按 Enter 打开浮层，焦点进到浮层里，再到设备栏。
  await page.locator('header [data-player-key="next"]').focus();
  await page.keyboard.press('Tab');
  await expect(square).toBeFocused();
  await page.keyboard.press('Enter');
  const panel = page.locator('[data-volume-popover]');
  await settled(panel);
  const device = panel.locator('[data-player-key="output"]');
  await device.focus();
  await expect(device).toBeFocused();
  await page.keyboard.press('Enter');
  const list = panel.getByRole('group', { name: '输出设备', exact: true });
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  // Esc 由浮层整体接住，列表开着也一并收起
  await expect(panel).toHaveCount(0);
  await expect(square).toBeFocused();
  expect(errors).toEqual([]);
});

test('胶囊的音量浮层：336 宽、两栏各 40 高，图标离左缘 20、内容从 46 起，数值与箭头离右缘 20', async ({
  page,
}) => {
  await choosePlayerBar(page, 'capsule');
  const { errors } = await openPlayer(page);
  await page.locator('[data-player-capsule] [data-player-key="volume"]').click();
  const flyout = page.locator('[data-volume-popover]');
  await settled(flyout);
  const box = await edgesOf(flyout);
  expect(box.right - box.left).toBe(336);
  const slider = flyout.getByRole('slider', { name: '音量' });
  const device = flyout.locator('[data-player-key="output"]');
  const value = flyout.locator('[data-player-key="mute"] ~ span').last();
  const [m, s, v, d, i, n, c] = await Promise.all(
    [
      flyout.locator('[data-player-key="mute"] svg'),
      slider,
      value,
      device,
      device.locator('svg').first(),
      device.locator('span span').first(),
      device.locator('svg').last(),
    ].map(edgesOf),
  );
  expect(d?.height).toBe(40);
  expect((m?.left ?? 0) - box.left).toBe(20);
  expect((i?.left ?? 0) - box.left).toBe(20);
  expect((s?.left ?? 0) - box.left).toBe(46);
  expect((n?.left ?? 0) - box.left).toBe(46);
  expect(box.right - (v?.right ?? 0)).toBe(20);
  expect(box.right - (c?.right ?? 0)).toBe(20);
  expect(errors).toEqual([]);
});

test('胶囊浮层的设备栏在原地展开成列表，再点收起；收起浮层再打开时是收着的', async ({ page }) => {
  await choosePlayerBar(page, 'capsule');
  const player = await openPlayer(page);
  switchableDevices(player);
  const key = page.locator('[data-player-capsule] [data-player-key="volume"]');
  await key.click();
  const flyout = page.locator('[data-volume-popover]');
  const device = flyout.locator('[data-player-key="output"]');
  await device.click();
  await expect(device).toHaveAttribute('aria-expanded', 'true');
  await expect(flyout.getByRole('group', { name: 'WASAPI (shared)' })).toBeVisible();
  await device.click();
  await expect(device).toHaveAttribute('aria-expanded', 'false');
  await expect(flyout.getByRole('group', { name: 'DirectSound' })).toHaveCount(0);

  await device.click();
  await flyout.locator(`[data-output-device="${OUTPUT_MODULES.directSound}|${SPEAKERS}"]`).click();
  await expect
    .poll(() => player.calls('config.setOutputDevice'))
    .toEqual([{ outputId: OUTPUT_MODULES.directSound, deviceId: SPEAKERS }]);
  await expect(device).toHaveAttribute('aria-expanded', 'false');
  await expect(device).toContainText('Speakers (Realtek(R) Audio)');
  // 选中的那一行随列表卸掉，焦点回到设备栏、浮层还开着。
  await expect(device).toBeFocused();
  await expect(flyout).toBeVisible();

  await device.click();
  await page.keyboard.press('Escape');
  await expect(flyout).toHaveCount(0);
  await key.click();
  await expect(flyout.locator('[data-player-key="output"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(player.errors).toEqual([]);
});

test('宽窗通栏的输出设备键：点开朝上的设备列表，选一个就收起、焦点回到键上', async ({ page }) => {
  const player = await openPlayer(page);
  switchableDevices(player);
  const key = page.locator('[data-player-bar] [data-player-key="output"]');
  await key.click();
  const list = page.locator('[data-device-list]');
  await settled(list);
  const keyBox = await edgesOf(key);
  const listBox = await edgesOf(list);
  expect(listBox.top + listBox.height).toBeLessThanOrEqual(keyBox.top);
  expect(Math.abs(listBox.right - keyBox.right)).toBeLessThanOrEqual(1);
  await deviceRow(page, `${OUTPUT_MODULES.wasapi}|${EXCLUSIVE}`).click();
  await expect
    .poll(() => player.calls('config.setOutputDevice'))
    .toEqual([{ outputId: OUTPUT_MODULES.wasapi, deviceId: EXCLUSIVE }]);
  await expect(list).toHaveCount(0);
  await expect(key).toBeFocused();
  expect(player.errors).toEqual([]);
});
