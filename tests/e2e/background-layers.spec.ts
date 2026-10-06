import { expect, test } from '@playwright/test';

test('换图等待解码，失败与超时撤掉旧图，迟到解码不能复活', async ({ page }) => {
  await page.goto('/');
  const data = await page.evaluate(async () => {
    const path = '/tests/fixtures/BackgroundLayersHarness.tsx';
    const {
      mountBackgroundLayersHarness,
    }: typeof import('../fixtures/BackgroundLayersHarness.tsx') = await import(path);
    const container = document.createElement('div');
    document.body.append(container);
    mountBackgroundLayersHarness(container);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.fillStyle = '#2844bb';
    context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL();
  });
  const input = page.getByRole('textbox', { name: '背景层地址' });
  const image = page.locator('[data-background-probe] [data-background-image]');
  await input.fill(data);
  await expect(image).toHaveAttribute('src', data);
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = false;
  await page.route('**/delayed-background.png', async (route) => {
    pending = true;
    await wait;
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(data.split(',')[1] ?? '', 'base64'),
    });
  });
  await page.clock.install();
  await input.fill('/delayed-background.png');
  await expect.poll(() => pending).toBe(true);
  await expect(image).toHaveAttribute('src', data);
  await page.clock.fastForward(10_001);
  await expect(image).toHaveCount(0);
  release();
  await page.clock.resume();
  await page.waitForTimeout(150);
  await expect(image).toHaveCount(0);
  await input.fill(data);
  await expect(image).toHaveAttribute('src', data);
  await input.fill('');
  await expect(image).toHaveCount(0);
  let resumeNext = () => {};
  const nextWait = new Promise<void>((resolve) => {
    resumeNext = resolve;
  });
  await page.route('**/next-background.png', async (route) => {
    await nextWait;
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(data.split(',')[1] ?? '', 'base64'),
    });
  });
  await input.fill('/next-background.png');
  try {
    await expect(image).toHaveCount(0);
  } finally {
    resumeNext();
  }
  await expect(image).toHaveAttribute('src', '/next-background.png');
  await page.route('**/missing-background.png', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await input.fill('/missing-background.png');
  await expect(image).toHaveCount(0);
});
