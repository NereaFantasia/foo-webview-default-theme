import { expect, test } from '@playwright/test';
import { openSettings, enterSettings } from '../fixtures/settingsPage.ts';

test('进入设置先读沉浸偏好，修改可保存且不启动可视化服务', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('default-theme.immersive.wash.v1') === null) {
      localStorage.setItem('default-theme.immersive.wash.v1', 'static');
      localStorage.setItem('default-theme.immersive.fpsCap.v1', '60');
    }
  });
  const settings = await openSettings(page);
  await expect(page.getByRole('switch', { name: '进入时全屏', exact: true })).toBeVisible();
  await settings.expand('背景');
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
  await settings.expand('背景');
  await settings.expand('性能');
  await expect(settings.select('封面底色')).toHaveText('不显示');
  await expect(settings.select('帧率上限')).toHaveText('30 fps');
  await expect(page.getByRole('switch', { name: '性能小窗', exact: true })).toBeChecked();
  expect(settings.errors).toEqual([]);
});
