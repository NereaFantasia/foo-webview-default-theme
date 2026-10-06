import { expect, test } from '@playwright/test';
import { openSongs } from '../fixtures/songsPage.ts';
import { answerTrackInfo, INFO_TAGS } from '../fixtures/trackInfoAnswers.ts';
import { stringParam } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';
import { biographyHtml, biographyOverviewHtml } from '../fixtures/biographySamples.ts';

const DISPLAY =
  'http://compllege.com/post/163636653001/cocd-0011-phant-2-2017年コミックマーケット92-1日目-金曜日-東7';
const ADDRESS = encodeURI(DISPLAY);
const COMMENT = `C92\r\n${ADDRESS}`;

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} 信息字段可读，外链先确认，原始标签和复制保持编码`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const view = await openSongs(page, {
      configure(host) {
        answerTrackInfo(host);
        host.answer('metadata.read', (params) => ({
          success: true,
          path: stringParam(params, 'path'),
          tags: { ...INFO_TAGS, COMMENT },
          info: { duration: 175, bitrate: 900, sampleRate: 44100, channels: 2, codec: 'FLAC' },
        }));
        host.answer('shell.openExternal', { success: true });
      },
    });
    await view.row('Feather').locator('[data-column-id="title"]').click();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('[data-right-card-key="queue"]').click();
    await page.locator('[data-right-card-page="info"]').click();
    const info = page.locator('[data-track-info]');
    await info.getByRole('button', { name: '参与者与发行', exact: true }).click();
    const link = info.getByRole('link', { name: DISPLAY, exact: true });
    await expect(link).toHaveAttribute('href', ADDRESS);
    await expect(link.locator('..')).toHaveCSS('white-space', 'pre-wrap');
    await expect(link.locator('..')).toHaveText(`C92\n${DISPLAY}`);
    const before = page.url();
    await link.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(ADDRESS);
    expect(view.host.callsTo('shell.openExternal')).toEqual([]);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await link.click({ button: 'middle' });
    await dialog.getByRole('button', { name: '打开链接', exact: true }).click();
    await expect.poll(() => view.host.callsTo('shell.openExternal')).toEqual([{ url: ADDRESS }]);
    expect(page.url()).toBe(before);
    await info.getByRole('button', { name: '全部标签', exact: true }).click();
    await info.getByRole('textbox', { name: '搜索字段名或值' }).fill('COMMENT');
    const raw = info
      .locator('dl > div')
      .filter({ has: page.getByText('COMMENT', { exact: true }) });
    await expect(raw).toContainText(ADDRESS);
    await expect(raw.getByRole('link')).toHaveCount(0);
    await raw.hover();
    await raw.getByRole('button', { name: '复制', exact: true }).click();
    await expect(info.getByText('已复制', { exact: true })).toBeVisible();
    expect(JSON.parse(String(view.host.callsTo('clipboard.write').at(-1)?.['text']))).toEqual({
      COMMENT,
    });
    expect(await info.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(view.errors).toEqual([]);
  });
}

test('简介正文复用可读链接，已有命名链接不被改写', async ({ page }) => {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page);
  host.answer('file.write', (params) => ({
    success: true,
    bytesWritten: String(params['content']).length,
  }));
  host.answer('http.get', (params) => ({
    success: true,
    status: 200,
    headers: {},
    body: String(params['url']).endsWith('/+wiki')
      ? biographyHtml('Queen', `<p>C92<br>${ADDRESS}</p><p><a href="${ADDRESS}">发行资料</a></p>`)
      : biographyOverviewHtml(),
  }));
  await page.goto('/tests/fixtures/readableTextHarness.html');
  await page.getByRole('switch', { name: '在线艺人简介' }).check();
  await page.getByRole('button', { name: '确认艺人', exact: true }).click();
  const panel = page.locator('[data-biography]');
  await expect(panel.getByRole('link', { name: DISPLAY, exact: true })).toHaveAttribute(
    'href',
    ADDRESS,
  );
  await expect(panel.getByRole('link', { name: '发行资料', exact: true })).toHaveAttribute(
    'href',
    ADDRESS,
  );
  expect(errors).toEqual([]);
});
