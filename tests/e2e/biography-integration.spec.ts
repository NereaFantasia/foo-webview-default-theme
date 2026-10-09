import { expect, test, type Page } from '@playwright/test';
import { BIOGRAPHY_PREFS_KEY } from '../../src/library/biography/biographyPrefs.ts';
import { biographyHtml, biographyOverviewHtml } from '../fixtures/biographySamples.ts';
import { openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';
import { enterSettings } from '../fixtures/settingsPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { lastfmCalls, withoutMusicbrainz } from '../fixtures/musicbrainzSamples.ts';
import {
  confirmBiographyExternal,
  expandBiographyArticle,
  openBiographyLink,
} from '../fixtures/biographyActions.ts';

const panel = (page: Page) => page.locator('[data-biography]');
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const toggle = (page: Page) => page.getByRole('switch', { name: '在线艺人简介' });

async function start(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const player = await openPlayer(page, {
    state: { track: makeTrack({ artist: 'Queen', title: 'One' }) },
  });
  player.host.answer(
    'http.get',
    withoutMusicbrainz((params) => {
      const url = new URL(String(params['url']));
      const name = decodeURIComponent(url.pathname.split('/music/')[1]?.split('/')[0] ?? '');
      const language = url.pathname.startsWith('/zh/') ? 'zh' : 'en';
      const html = url.pathname.endsWith('/+wiki')
        ? biographyHtml(name, `<p>${name} 的正文</p>`, language)
        : biographyOverviewHtml(name, language);
      return {
        success: true,
        status: 200,
        headers: {},
        body: html,
        responseType: 'text',
      };
    }),
  );
  player.host.answer('file.write', (params) => ({
    success: true,
    bytesWritten: String(params['content']).length,
  }));
  await enterSettings(page);
  await page.locator('[data-settings-nav]').getByRole('button', { name: '在线内容' }).click();
  await page
    .locator('[data-settings-expander]')
    .filter({ has: page.getByRole('switch', { name: '在线艺人简介', exact: true }) })
    .locator('[data-settings-toggle]')
    .click();
  await expect(toggle(page)).toBeEnabled();
  return player;
}

async function openBiography(page: Page) {
  await page.locator('[data-right-card-key="queue"]').click();
  await tab(page, '简介').click();
  await expect(panel(page)).toBeVisible();
}

async function confirm(page: Page) {
  await openBiographyLink(page);
  await panel(page).getByRole('button', { name: '确认艺人', exact: true }).click();
}

async function settled(page: Page) {
  await expect(panel(page).getByRole('button', { name: '刷新简介' })).toBeEnabled();
}

async function changeTrack(player: PlayerPage, artist: string) {
  const track = makeTrack({
    artist,
    title: `Song ${artist}`,
    path: `file://E:/Music/${artist}.flac`,
  });
  player.state.track = track;
  await player.host.emit('playback:trackChanged', track);
}

test('主窗设置、简介分页与来源许可接通，重载恢复开关和已确认身份', async ({ page }) => {
  const { host, errors } = await start(page);
  await openBiography(page);
  await expect(panel(page).getByText('在线简介未开启')).toBeVisible();
  expect(lastfmCalls(host.callsTo('http.get'))).toEqual([]);
  await toggle(page).check();
  await expect(panel(page).locator('[data-biography-link]')).toBeVisible();
  expect(lastfmCalls(host.callsTo('http.get'))).toEqual([]);
  await confirm(page);
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await expandBiographyArticle(page);
  await expect(panel(page).getByText('CC BY-SA 3.0')).toBeVisible();
  await settled(page);
  expect(lastfmCalls(host.callsTo('http.get'))).toHaveLength(2);
  await expect
    .poll(() => host.config.get(BIOGRAPHY_PREFS_KEY))
    .toEqual({
      version: 1,
      enabled: true,
      language: 'auto',
      identities: [{ artist: 'Queen', sourceArtist: 'Queen' }],
    });
  host.answer('shell.openExternal', { success: true });
  await panel(page).getByText('Last.fm · 用户撰写').click();
  await confirmBiographyExternal(page);
  await expect.poll(() => host.callsTo('shell.openExternal')).toHaveLength(1);
  expect(host.callsTo('shell.openExternal')[0]?.['url']).toBe(
    'https://www.last.fm/zh/music/Queen/+wiki',
  );
  await page.reload();
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: '确认艺人', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('换曲后立即撤掉旧艺人，换页和收起期间不联网，停止后清空', async ({ page }) => {
  const player = await start(page);
  await toggle(page).check();
  await openBiography(page);
  await confirm(page);
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await settled(page);
  await changeTrack(player, 'Other');
  await expect(panel(page).getByRole('heading', { name: 'Other', exact: true })).toBeVisible();
  await expect(panel(page).getByText('Queen 的正文')).toHaveCount(0);
  await expect(panel(page).locator('[data-biography-link]')).toBeVisible();
  const held = player.host.hold('http.get');
  await confirm(page);
  await expect.poll(() => held.pending.length).toBe(1);
  await tab(page, '队列').click();
  held.respond(0);
  held.release();
  await expect(panel(page)).toHaveCount(0);
  await tab(page, '简介').click();
  await expect(panel(page).getByText('Other 的正文')).toBeVisible();
  await settled(page);
  const count = lastfmCalls(player.host.callsTo('http.get')).length;
  await page.locator('[data-right-card-key="queue"]').click();
  await page.locator('[data-right-card-key="queue"]').click();
  await changeTrack(player, 'Queen');
  await page.waitForTimeout(400);
  expect(lastfmCalls(player.host.callsTo('http.get'))).toHaveLength(count);
  await openBiography(page);
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  player.state.state = 'stopped';
  await player.host.emit('playback:stateChanged', {
    state: 'stopped',
    canSeek: false,
    position: 0,
    duration: 0,
    hostTime: Date.now(),
  });
  await expect(panel(page)).toHaveAttribute('data-biography-state', 'idle');
  await expect(panel(page).getByRole('heading')).toHaveCount(0);
  expect(player.errors).toEqual([]);
});

test('界面语言决定来源语言，关闭在线设置使在途正文失效', async ({ page }) => {
  const { host, errors } = await start(page);
  await toggle(page).check();
  await openBiography(page);
  await confirm(page);
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await settled(page);
  const held = host.hold('http.get');
  await page.getByRole('combobox', { name: '界面语言' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect.poll(() => held.pending.length).toBe(1);
  expect(lastfmCalls(host.callsTo('http.get')).at(-1)?.['url']).toBe(
    'https://www.last.fm/music/Queen/+wiki',
  );
  await expect(panel(page).getByText('Queen 的正文')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Online biographies' }).uncheck();
  held.respond(0);
  held.release();
  await expect(panel(page).getByText('Online biographies are off')).toBeVisible();
  await expect(panel(page).getByText('Queen 的正文')).toHaveCount(0);
  await expect.poll(() => host.config.get(BIOGRAPHY_PREFS_KEY)).toMatchObject({ enabled: false });
  expect(errors).toEqual([]);
});

test('沉浸视图或隐藏页面暂停采集，返回时恢复已有正文', async ({ page }) => {
  const { host, errors } = await start(page);
  await toggle(page).check();
  await openBiography(page);
  await confirm(page);
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await settled(page);
  const held = host.hold('http.get');
  await panel(page).getByRole('button', { name: '刷新简介' }).click();
  await expect.poll(() => held.pending.length).toBe(1);
  await page.locator('[data-player-bar] [data-player-key="cover"]').click();
  await expect(page.getByRole('region', { name: '正在播放', exact: true })).toBeVisible();
  held.respond(0, {
    success: true,
    status: 200,
    headers: {},
    body: biographyHtml('Queen', '<p>不应采纳的晚到正文</p>'),
    responseType: 'text',
  });
  held.release();
  await page.keyboard.press('Escape');
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await expect(panel(page).getByText('不应采纳的晚到正文')).toHaveCount(0);
  const count = lastfmCalls(host.callsTo('http.get')).length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(panel(page).getByText('Queen 的正文')).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(lastfmCalls(host.callsTo('http.get'))).toHaveLength(count);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  expect(errors).toEqual([]);
});

test('中文没有正文时显示纯英文，简介语言可独立切换日语并跨重载保存', async ({ page }) => {
  const { host, errors } = await start(page);
  host.answer(
    'http.get',
    withoutMusicbrainz((params) => {
      const path = new URL(String(params['url'])).pathname;
      const language = path.startsWith('/ja/') ? 'ja' : 'en';
      return {
        success: true,
        status: path.startsWith('/zh/') ? 404 : 200,
        headers: {},
        body: !path.endsWith('/+wiki')
          ? biographyOverviewHtml('Queen', language)
          : biographyHtml(
              'Queen',
              language === 'ja'
                ? '<p>クイーンはイギリスのロックバンドです。</p>'
                : '<p>Queen is a British rock band.</p>',
              language,
            ),
        responseType: 'text',
      };
    }),
  );
  await toggle(page).check();
  await openBiography(page);
  await confirm(page);
  await expect(panel(page).getByText('Queen is a British rock band.')).toBeVisible();
  await expandBiographyArticle(page);
  await settled(page);
  expect(lastfmCalls(host.callsTo('http.get')).map((call) => call['url'])).toEqual([
    'https://www.last.fm/zh/music/Queen/+wiki',
    'https://www.last.fm/music/Queen/+wiki',
    'https://www.last.fm/music/Queen',
  ]);
  await expect(panel(page).getByText('未找到可用简介')).toHaveCount(0);
  host.answer('shell.openExternal', { success: true });
  await panel(page).getByText('Last.fm · 用户撰写').click();
  await confirmBiographyExternal(page);
  await expect
    .poll(() => host.callsTo('shell.openExternal')[0]?.['url'])
    .toBe('https://www.last.fm/music/Queen/+wiki');
  const select = page.getByRole('combobox', { name: '简介语言', exact: true });
  await select.click();
  await page.getByRole('option', { name: '日本語', exact: true }).click();
  await expect(panel(page).getByText('クイーンはイギリスのロックバンドです。')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '设置', exact: true })).toBeVisible();
  await expect
    .poll(() => host.config.get(BIOGRAPHY_PREFS_KEY))
    .toMatchObject({ language: 'ja', enabled: true });
  await page.reload();
  await expect(panel(page).getByText('クイーンはイギリスのロックバンドです。')).toBeVisible();
  await enterSettings(page);
  await page.getByRole('button', { name: '在线艺人简介', exact: true }).click();
  await expect(select).toHaveText('日本語');
  expect(errors).toEqual([]);
});

test('设置页统计与清理接入，关闭在线仍可清理，不清除身份与语言', async ({ page }) => {
  const { host, errors } = await start(page);
  await toggle(page).check();
  await openBiography(page);
  await confirm(page);
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await settled(page);
  const cache = page
    .locator('[data-settings-row]')
    .filter({ has: page.getByText('简介缓存', { exact: true }) });
  await expect(cache).toContainText('2 条');
  await toggle(page).uncheck();
  await cache.getByRole('button', { name: '清理缓存' }).click();
  await expect(cache).toContainText('0 条');
  await expect
    .poll(() => host.config.get(BIOGRAPHY_PREFS_KEY))
    .toMatchObject({
      enabled: false,
      language: 'auto',
      identities: [{ artist: 'Queen', sourceArtist: 'Queen' }],
    });
  await toggle(page).check();
  await expect(panel(page).getByText('简介缓存已清理')).toBeVisible();
  expect(lastfmCalls(host.callsTo('http.get'))).toHaveLength(2);
  await panel(page).getByRole('button', { name: '刷新简介' }).click();
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await expect(cache).toContainText('1 条');
  expect(errors).toEqual([]);
});
