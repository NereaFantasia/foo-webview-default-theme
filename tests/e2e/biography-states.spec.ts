import { expect, test, type Page } from '@playwright/test';
import {
  biographyHtml,
  biographyLocalTracks,
  biographyOverviewHtml,
} from '../fixtures/biographySamples.ts';
import { openPlayer } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { lastfmCalls, withoutMusicbrainz } from '../fixtures/musicbrainzSamples.ts';
import {
  expandBiographyArticle,
  openBiographyLink,
  openBiographySettings,
} from '../fixtures/biographyActions.ts';

const panel = (page: Page) => page.locator('[data-biography]');

async function start(page: Page, width = 1280) {
  const env = await openPlayer(page, { width, state: { track: makeTrack({ artist: 'Queen' }) } });
  env.host.answer('library.getArtistTracks', (params) => {
    const artist = String(params['artist']);
    const tracks = biographyLocalTracks(artist);
    return {
      success: true,
      artist,
      tracks,
      items: tracks,
      count: tracks.length,
      total: tracks.length,
    };
  });
  env.host.answer('file.write', (params) => ({
    success: true,
    bytesWritten: String(params['content']).length,
  }));
  env.host.answer(
    'http.get',
    withoutMusicbrainz((params) => ({
      success: true,
      status: 200,
      headers: {},
      body: String(params['url']).endsWith('/+wiki') ? biographyHtml() : biographyOverviewHtml(),
    })),
  );
  await page.locator('[data-right-card-key="queue"]').click();
  await page.getByRole('tab', { name: '简介', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  return env;
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme} 关闭态显示真实库内资料，不联网，无图不留大框，直达在线设置并可后退`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const env = await start(page);
    await expect(panel(page).getByText('在线简介未开启')).toBeVisible();
    await expect(panel(page).locator('[data-biography-library]')).toContainText(
      '3 首 · 45分钟 · 1 张专辑 · 1 张参与专辑',
    );
    await expect(panel(page).locator('[data-biography-collaborators]')).toHaveText(
      '常合作 Guest · Other',
    );
    await expect(panel(page).locator('[data-biography-photos]')).toHaveCount(0);
    expect(lastfmCalls(env.host.callsTo('http.get'))).toEqual([]);
    await openBiographySettings(page);
    const toggle = page.getByRole('switch', { name: '在线艺人简介' });
    await expect(toggle).toBeFocused();
    await expect(
      page.locator('[data-settings-nav]').getByRole('button', { name: '在线内容' }),
    ).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.locator('[data-page="settings"]')).toHaveCount(0);
    expect(env.errors).toEqual([]);
  });
}

test('无资料和网络错误分开，保留本地统计，重选与刷新可用，恢复后显示正文和来源', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await start(page);
  await openBiographySettings(page);
  await page.getByRole('switch', { name: '在线艺人简介' }).check();
  env.host.answer(
    'http.get',
    withoutMusicbrainz({ success: true, status: 404, headers: {}, body: '' }),
  );
  await openBiographyLink(page);
  await panel(page).getByRole('button', { name: '确认艺人', exact: true }).click();
  await expect(panel(page).getByText('未找到可用简介')).toBeVisible();
  await expect(panel(page).locator('[data-biography-library]')).toContainText('3 首');
  await expect(panel(page).locator('[data-biography-collaborators]')).toContainText('Guest');
  const refresh = panel(page).getByRole('button', { name: '刷新简介' });
  await expect(refresh).toBeEnabled();
  env.host.answer(
    'http.get',
    withoutMusicbrainz({ success: true, status: 503, headers: {}, body: '' }),
  );
  await refresh.click();
  await expect(panel(page).getByText('无法连接数据源', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('未找到可用简介')).toHaveCount(0);
  env.host.answer(
    'http.get',
    withoutMusicbrainz((params) => ({
      success: true,
      status: 200,
      headers: {},
      body: String(params['url']).endsWith('/+wiki') ? biographyHtml() : biographyOverviewHtml(),
    })),
  );
  await refresh.click();
  await expect(panel(page).getByText('第一段简介。', { exact: true })).toBeVisible();
  await expandBiographyArticle(page);
  await expect(panel(page).getByText('CC BY-SA 3.0')).toBeVisible();
  await panel(page).getByRole('button', { name: '重新确认艺人' }).click();
  await openBiographyLink(page);
  await expect(panel(page).getByRole('textbox', { name: 'Last.fm 艺人链接' })).toBeVisible();
  await expect(panel(page).getByText('第一段简介。', { exact: true })).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('窄窗直达设置时收起覆盖层，焦点落到在线开关，不横向溢出', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await start(page, 390);
  await expect(panel(page).locator('[data-biography-library]')).toContainText('3 首');
  await openBiographySettings(page);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('switch', { name: '在线艺人简介' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(env.errors).toEqual([]);
});

for (const [colorScheme, width] of [
  ['dark', 1280],
  ['light', 390],
] as const) {
  test(`${colorScheme} 未匹配时表单收起，键盘展开、链接校验与重新匹配可用`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const env = await start(page, width);
    await openBiographySettings(page);
    await page.getByRole('switch', { name: '在线艺人简介' }).check();
    if (width < 1008) {
      await page.locator('[data-right-card-key="queue"]').click();
      await page.getByRole('tab', { name: '简介', exact: true }).click();
    }
    const details = panel(page).locator('[data-biography-link]');
    const summary = details.locator('summary');
    const field = details.getByRole('textbox', { name: 'Last.fm 艺人链接' });
    const note = details.getByText('MusicBrainz 中未找到此艺人');
    await expect(note).toHaveCount(1);
    await expect(note).toBeHidden();
    await expect(panel(page).getByText('尚未关联在线资料')).toHaveCount(0);
    await expect(field).toBeHidden();
    await expect(panel(page).getByRole('button', { name: '刷新简介' })).toHaveCount(0);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(field).toBeVisible();
    await expect(note).toBeVisible();
    const buttonBox = await details.getByRole('button', { name: '确认艺人' }).boundingBox();
    const formBox = await details.locator('form').boundingBox();
    expect(buttonBox && formBox && buttonBox.width < formBox.width / 2).toBe(true);
    expect(
      buttonBox &&
        formBox &&
        Math.abs(buttonBox.x + buttonBox.width - formBox.x - formBox.width) < 1,
    ).toBe(true);
    await field.fill('https://www.last.fm.evil.example/music/Queen');
    await field.press('Enter');
    await expect(details.getByText('请输入使用 HTTPS 的 Last.fm 艺人链接')).toBeVisible();
    expect(lastfmCalls(env.host.callsTo('http.get'))).toEqual([]);
    await summary.locator('svg').click();
    await expect(field).toBeHidden();
    await openBiographyLink(page);
    await expect(field).toHaveValue('https://www.last.fm.evil.example/music/Queen');
    const held = env.host.hold('http.get');
    await panel(page).getByRole('button', { name: '简介选项' }).click();
    await page.getByRole('menuitem', { name: '重新匹配', exact: true }).click();
    await expect.poll(() => held.pending.length).toBe(1);
    await expect(panel(page).getByRole('progressbar', { name: '正在读取简介' })).toHaveCount(1);
    held.respond(0, { success: true, status: 500, headers: {}, body: '' });
    held.release();
    await expect(panel(page).getByText('未能确认艺人 · 无法连接数据源')).toBeVisible();
    await expect(panel(page).getByText('尚未关联在线资料')).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: '重试', exact: true })).toBeEnabled();
    await field.fill('https://www.last.fm/zh/music/Queen');
    await field.press('Enter');
    await expect(panel(page).getByText('第一段简介。', { exact: true })).toBeVisible();
    await expect(details).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(env.errors).toEqual([]);
  });
}
