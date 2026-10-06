import { expect, test, type Page } from '@playwright/test';
import { openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

test.use({ screenshot: 'off' });

const LOCAL = '[00:01]前奏\n[00:40]本地句\n[00:40]本地译文\n[00:45]下一句';
const ONLINE = '[00:40]所选句\n[00:40]所选译文\n[00:45]所选下一句';
const panel = (page: Page) => page.locator('[data-lyrics-panel]');
const view = (page: Page) => page.getByRole('region', { name: '正在播放', exact: true });
const entry = (page: Page) => page.locator('[data-player-bar] [data-player-key="cover"]');

function localReply(text: string) {
  return {
    success: true,
    available: true,
    source: 'embedded',
    path: '',
    lyrics: text,
    synced: true,
  } as const;
}

function onlineReplies(env: PlayerPage) {
  env.host.answer('http.get', (params) => {
    const url = new URL(String(params['url']));
    const track = env.state.track;
    const data =
      url.hostname === 'lrclib.net' && track
        ? [
            {
              id: 1,
              trackName: track.title,
              artistName: track.artist,
              albumName: track.album,
              duration: track.duration,
              syncedLyrics: ONLINE,
            },
          ]
        : url.hostname === 'music.163.com'
          ? { code: 200, result: { songs: [] } }
          : { status: 200, candidates: [] };
    return {
      success: true,
      status: 200,
      headers: {},
      responseType: 'text',
      body: url.hostname === 'raw.githubusercontent.com' ? '' : JSON.stringify(data),
    };
  });
}

async function openLyrics(page: Page) {
  const env = await openPlayer(page, { state: { state: 'paused' } });
  env.host.answer('lyrics.get', localReply(LOCAL));
  onlineReplies(env);
  await page.locator('[data-right-card-key="lyrics"]').click();
  await panel(page).getByRole('button', { name: '重新读取歌词' }).click();
  await expect(panel(page).locator('[data-lyrics-status]')).toHaveAttribute(
    'data-lyrics-status',
    'ready',
  );
  return env;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}：手动选词跨视图共享，六档同步，退出恢复预览且不重读`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const env = await openLyrics(page);
    await panel(page).hover();
    await panel(page).getByRole('switch', { name: '在线歌词' }).check();
    await panel(page).getByRole('button', { name: '搜索歌词', exact: true }).click();
    const search = panel(page).locator('[data-lyrics-search]');
    await search.getByRole('radio').check();
    await search.getByRole('button', { name: '使用歌词' }).click();
    await expect(panel(page).locator('[data-lyrics-source]')).toHaveText('LRCLIB');
    const reads = env.host.callsTo('lyrics.get').length;
    const requests = env.host.callsTo('http.get').length;
    env.state.state = 'playing';
    await env.host.emit('playback:stateChanged', {
      state: 'playing',
      position: 42,
      duration: 240,
      canSeek: true,
      hostTime: Date.now(),
    });
    await expect(panel(page).locator('.amll-lyric-player')).toHaveClass(/playing/);
    await entry(page).click();
    await expect(panel(page).locator('.amll-lyric-player')).not.toHaveClass(/playing/);
    env.state.state = 'paused';
    await env.host.emit('playback:stateChanged', {
      state: 'paused',
      position: 42,
      duration: 240,
      canSeek: true,
      hostTime: Date.now(),
    });
    await expect(view(page).locator('[data-field="lyric-main"]')).toHaveText('所选句');
    await expect(view(page).locator('[data-field="lyric-sub"]')).toHaveText('所选译文');
    await expect(view(page).locator('[data-field="lyrics-source"]')).toHaveText('lrclib · synced');
    for (const [width, height, tier] of [
      [1200, 720, 'compact'],
      [390, 700, 'narrow'],
      [864, 1536, 'portrait'],
      [720, 1280, 'portrait-compact'],
      [700, 1000, 'portrait-narrow'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(view(page).locator('[data-tier]')).toHaveAttribute('data-tier', tier);
      const current = view(page).locator('[data-slot="current"]');
      await expect(current).toHaveText('00:40所选句');
      const box = await current.boundingBox();
      expect(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width).toBe(true);
    }
    env.state.position = 46;
    await env.host.emit('playback:seeked', { position: 46, hostTime: Date.now() });
    await expect(view(page).locator('[data-slot="current"]')).toHaveText('00:45所选下一句');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(view(page).locator('[data-tier]')).toHaveAttribute('data-tier', 'full');
    await expect(view(page).locator('[data-field="lyric-main"]')).toHaveText('所选下一句');
    await page.keyboard.press('Escape');
    await expect(view(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-lyrics-source]')).toHaveText('LRCLIB');
    await entry(page).click();
    await expect(view(page).locator('[data-field="lyric-main"]')).toHaveText('所选下一句');
    expect(env.host.callsTo('lyrics.get')).toHaveLength(reads);
    expect(env.host.callsTo('http.get')).toHaveLength(requests);
    expect(env.host.callsTo('lyrics.save')).toHaveLength(0);
    expect(env.errors).toEqual([]);
  });
}

test('未打开预览也能在沉浸视图取在线词，关闭联网后不再沿用', async ({ page }) => {
  const env = await openPlayer(page, { state: { state: 'paused' } });
  env.host.answer('lyrics.get', { success: true, available: false, path: '' });
  onlineReplies(env);
  env.host.config.set('defaultTheme.online.lyrics', {
    version: 1,
    enabled: true,
    sources: ['lrclib'],
  });
  await page.reload();
  await expect(entry(page)).toBeEnabled();
  expect(env.host.callsTo('http.get')).toHaveLength(0);
  const held = env.host.hold('http.get');
  await entry(page).click();
  await expect(view(page).locator('[data-field="lyrics-status"]')).toHaveText('正在搜索歌词');
  held.release();
  await expect(view(page).locator('[data-field="lyric-main"]')).toHaveText('所选句');
  await page.keyboard.press('Escape');
  await page.locator('[data-right-card-key="lyrics"]').click();
  await expect(panel(page).locator('[data-lyrics-source]')).toHaveText('LRCLIB');
  await panel(page).hover();
  await panel(page).getByRole('switch', { name: '在线歌词' }).uncheck();
  await expect(panel(page)).toContainText('没有找到本地歌词');
  await entry(page).click();
  await expect(view(page).locator('[data-field="lyric-main"]')).toHaveCount(0);
  await expect(view(page).locator('[data-field="lyrics-status"]')).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('切歌清除旧句并丢弃晚到内容，失败与纯文本保留对应状态，停播清空', async ({ page }) => {
  const env = await openLyrics(page);
  await entry(page).click();
  await expect(view(page).locator('[data-field="lyric-main"]')).toHaveText('本地句');
  const held = env.host.hold('lyrics.get');
  for (const title of ['上一首', '新曲目']) {
    env.state.track = makeTrack({ path: `file://E:/${title}.flac`, title });
    await env.host.emit('playback:trackChanged', env.state.track);
    await expect(view(page).locator('[data-field="lyrics-status"]')).toHaveText('正在读取歌词');
  }
  await expect.poll(() => held.pending.length).toBe(2);
  held.respond(1, localReply('[00:40]新曲歌词'));
  await expect(view(page).locator('[data-field="lyric-main"]')).toHaveText('新曲歌词');
  held.respond(0, localReply('[00:40]过期歌词'));
  await expect(view(page)).not.toContainText('过期歌词');
  held.release();
  env.host.answer('lyrics.get', hostFailure('OPERATION_FAILED'));
  env.state.track = makeTrack({ path: 'file://E:/failed.flac' });
  await env.host.emit('playback:trackChanged', env.state.track);
  await expect(view(page).locator('[data-field="lyrics-status"]')).toHaveText('本地歌词读取失败');
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(view(page).locator('[data-field="lyrics-status"]')).toHaveText('本地歌词读取失败');
  env.host.answer('lyrics.get', localReply('纯文本一\n纯文本二'));
  env.state.track = makeTrack({ path: 'file://E:/plain.flac' });
  await env.host.emit('playback:trackChanged', env.state.track);
  await expect(view(page).locator('[data-field="lyrics-plain"]')).toContainText('2');
  env.state.state = 'stopped';
  env.state.track = null;
  await env.host.emit('playback:stopped', { reason: 'user' });
  await expect(view(page).locator('[data-field="lyrics-plain"]')).toHaveCount(0);
  await expect(view(page).locator('[data-slot="current"]')).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('进入沉浸视图取消候选搜索；恢复预览后可继续查找', async ({ page }) => {
  const env = await openLyrics(page);
  await panel(page).hover();
  await panel(page).getByRole('switch', { name: '在线歌词' }).check();
  const held = env.host.hold('http.get');
  await panel(page).getByRole('button', { name: '搜索歌词', exact: true }).click();
  await expect.poll(() => held.pending.length).toBeGreaterThan(0);
  await entry(page).click();
  await expect(view(page).locator('[data-field="lyric-main"]')).toHaveText('本地句');
  held.release();
  await expect(panel(page).getByRole('radio')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(view(page)).toHaveCount(0);
  await expect(panel(page).getByRole('radio')).toHaveCount(1);
  expect(env.errors).toEqual([]);
});
