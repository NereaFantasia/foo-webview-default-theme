import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { openSettings } from '../fixtures/settingsPage.ts';

/** 边长 `side` 的全零灰度 PNG：文件只有几十 KB，像素数却是 `side` 的平方。 */
function hugePng(side: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((side + 1) * side), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('超过像素限制的背景图在整图解码前被拒绝，也不保存', async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    window.createImageBitmap = new Proxy(window.createImageBitmap, {
      apply(target, context: typeof window, args: unknown[]) {
        calls += 1;
        return Reflect.apply(target, context, args);
      },
    });
    Reflect.set(window, '__bitmapCalls', () => calls);
  });
  const settings = await openSettings(page);
  const content = hugePng(8192).toString('base64');
  settings.host.answer('dialog.openFile', {
    success: true,
    filePaths: ['D:\\Pictures\\huge.png'],
    canceled: false,
  });
  settings.host.answer('file.read', {
    success: true,
    content,
    size: content.length,
    encoding: 'base64',
  });
  settings.host.answer('file.write', { success: true, bytesWritten: content.length });
  await settings.choose('窗口背景', '图片');
  await page.getByRole('button', { name: '选择背景图片', exact: true }).click();
  await expect(settings.row('背景图片')).toContainText('图片超过 6400 万像素');
  await expect(page.locator('[data-background-image]')).toHaveCount(0);
  expect(settings.host.callsTo('file.write')).toHaveLength(0);
  const calls = await page.evaluate(() => {
    const read: unknown = Reflect.get(window, '__bitmapCalls');
    return typeof read === 'function' ? Number(read()) : -1;
  });
  expect(calls).toBe(0);
});
