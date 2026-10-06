import { expect, test, type Page } from '@playwright/test';
import { openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';

test.use({ screenshot: 'off' });

const LOCAL = '[00:01]前奏\n[00:40]第一句\n[00:40]第一句译文\n[00:45]第二句\n[00:50]尾句';
const panel = (page: Page) => page.locator('[data-lyrics-panel]');
const key = (page: Page) => page.locator('[data-right-card-key="lyrics"]');
const lyricsPlayer = (page: Page) => panel(page).locator('.amll-lyric-player');

async function openLyrics(page: Page, text: string | null = LOCAL, width = 1280) {
  const env = await openPlayer(page, { width });
  env.host.answer(
    'lyrics.get',
    text === null
      ? { success: true, available: false, path: '' }
      : {
          success: true,
          available: true,
          source: 'embedded',
          path: '',
          lyrics: text,
          synced: true,
        },
  );
  await key(page).click();
  const refresh = panel(page).getByRole('button', { name: '重新读取歌词' });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(panel(page).locator('[data-lyrics-status]')).toHaveAttribute(
    'data-lyrics-status',
    text ? 'ready' : 'missing',
  );
  return env;
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
              syncedLyrics: '[00:40]在线第一句\n[00:45]在线第二句',
            },
          ]
        : url.hostname === 'music.163.com'
          ? { code: 200, result: { songs: [] } }
          : { status: 200, candidates: [] };
    return {
      success: true,
      status: 200,
      headers: {},
      body: url.hostname === 'raw.githubusercontent.com' ? '' : JSON.stringify(data),
      responseType: 'text',
    };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}：本地同步歌词、译文、点击和键盘跳转，切回队列仍可用`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const env = await openLyrics(page);
    await expect(lyricsPlayer(page)).toBeVisible();
    await expect(panel(page).locator('[data-lyrics-source]')).toHaveText('内嵌歌词');
    await expect(key(page)).toHaveAttribute('aria-pressed', 'true');
    if (scheme === 'light') await expect(lyricsPlayer(page)).toHaveCSS('mix-blend-mode', 'normal');
    await lyricsPlayer(page).getByText('第一句', { exact: true }).click();
    await expect
      .poll(() => env.host.callsTo('playback.setPosition').at(-1))
      .toEqual({ position: 40 });
    await panel(page).getByRole('tab', { name: '全文', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: '第一句 第一句译文' })).toBeVisible();
    const second = panel(page).getByRole('button', { name: '第二句', exact: true });
    await second.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => env.host.callsTo('playback.setPosition').at(-1))
      .toEqual({ position: 45 });
    await page.getByRole('tab', { name: '队列', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await page.getByRole('tab', { name: '歌词', exact: true }).click();
    await expect(lyricsPlayer(page)).toBeVisible();
    expect(env.host.callsTo('http.get')).toHaveLength(0);
    expect(env.errors).toEqual([]);
  });
}

test('本地无词时默认不联网，启用后取词并保存，关闭后撤掉在线内容', async ({ page }) => {
  const env = await openLyrics(page, null);
  onlineReplies(env);
  await expect(panel(page).getByRole('switch', { name: '在线歌词' })).not.toBeChecked();
  expect(env.host.callsTo('http.get')).toHaveLength(0);
  await expect(panel(page)).toContainText('不发送文件路径');
  await panel(page).getByRole('button', { name: '搜索在线歌词' }).click();
  await expect(panel(page).getByRole('switch', { name: '在线歌词' })).toBeFocused();
  await expect(panel(page).locator('[data-lyrics-source]')).toHaveText('LRCLIB');
  await expect(lyricsPlayer(page).getByText('在线第一句', { exact: true })).toBeVisible();
  await expect
    .poll(() => env.host.config.get('defaultTheme.online.lyrics'))
    .toMatchObject({
      version: 1,
      enabled: true,
      sources: ['netease', 'kugou', 'ttmlDb', 'lrclib', 'lrcmux'],
    });
  expect(JSON.stringify(env.host.callsTo('http.get'))).not.toContain('E:/Music');
  await panel(page).getByRole('switch', { name: '在线歌词' }).uncheck();
  await expect(panel(page)).toContainText('没有找到本地歌词');
  await expect(lyricsPlayer(page)).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('读取失败可重试，纯文本可滚动，换曲后旧应答不串词', async ({ page }) => {
  const env = await openLyrics(page);
  env.host.answer('lyrics.get', hostFailure('OPERATION_FAILED'));
  await panel(page).getByRole('button', { name: '重新读取歌词' }).click();
  await expect(panel(page)).toContainText('本地歌词读取失败');
  env.host.answer('lyrics.get', {
    success: true,
    available: true,
    path: '',
    source: 'file',
    lyrics: Array.from({ length: 40 }, (_, i) => `纯文本第${i}行`).join('\n'),
    synced: false,
  });
  await panel(page).getByRole('button', { name: '重试', exact: true }).click();
  await expect(panel(page).locator('[data-lyrics-source]')).toHaveText('歌词文件');
  await expect(panel(page).getByRole('button', { name: '重新读取歌词' })).toBeFocused();
  await expect(panel(page).getByText('纯文本第0行', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('tab', { name: '全文', exact: true })).toHaveCount(0);
  const held = env.host.hold('lyrics.get');
  const before = env.host.callsTo('lyrics.get').length;
  await panel(page).getByRole('button', { name: '重新读取歌词' }).click();
  await expect.poll(() => env.host.callsTo('lyrics.get').length).toBe(before + 1);
  env.state.track = makeTrack({ path: 'file://E:/new.flac', title: '新曲目' });
  await env.host.emit('playback:trackChanged', env.state.track);
  await expect.poll(() => env.host.callsTo('lyrics.get').length).toBe(before + 2);
  held.respond(1, {
    success: true,
    available: true,
    path: '',
    source: 'file',
    lyrics: '新曲目的歌词',
    synced: false,
  });
  await expect(panel(page).getByText('新曲目的歌词', { exact: true })).toBeVisible();
  held.respond(0, {
    success: true,
    available: true,
    path: '',
    source: 'file',
    lyrics: '过期歌词',
    synced: false,
  });
  await expect(panel(page)).not.toContainText('过期歌词');
  expect(env.errors).toEqual([]);
});

test('未连接宿主时保留重试入口，不显示永久加载状态', async ({ page }) => {
  await page.goto('/');
  await key(page).click();
  await expect(panel(page)).toContainText('未连接 foobar2000');
  await expect(panel(page).getByRole('switch', { name: '在线歌词' })).toBeDisabled();
  const retry = panel(page).getByRole('button', { name: '重试', exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(panel(page).getByRole('button', { name: '重新读取歌词' })).toBeFocused();
});

test('保存失败不回滚联网开关，可重试保存', async ({ page }) => {
  const env = await openLyrics(page, null);
  onlineReplies(env);
  env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
  await panel(page).getByRole('switch', { name: '在线歌词' }).check();
  await expect(panel(page)).toContainText('设置已生效，但未能保存');
  await expect(panel(page).getByRole('switch', { name: '在线歌词' })).toBeChecked();
  env.host.answer('config.set', (params) => ({ success: true, key: String(params['key']) }));
  await panel(page).getByRole('button', { name: '重试保存' }).click();
  await expect(panel(page).locator('[data-save-feedback]')).toContainText('已保存');
  expect(env.errors).toEqual([]);
});

test('暂停和恢复同步到播放器，不可跳转时禁用行按钮，停播后清空歌词', async ({ page }) => {
  const env = await openLyrics(page);
  const player = lyricsPlayer(page);
  await expect(player).toHaveClass(/playing/);
  env.state.state = 'paused';
  await env.host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'paused',
    position: 42,
    duration: 240,
    canSeek: true,
  });
  await expect(player).not.toHaveClass(/playing/);
  await expect(page.locator('[data-right-card-playback-state]')).toHaveText('已暂停');
  env.state.state = 'playing';
  env.state.canSeek = false;
  await env.host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 42,
    duration: 240,
    canSeek: false,
  });
  await expect(player).toHaveClass(/playing/);
  await panel(page).getByRole('tab', { name: '全文', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: '第二句', exact: true })).toBeDisabled();
  expect(env.host.callsTo('playback.setPosition')).toHaveLength(0);
  env.state.state = 'stopped';
  env.state.track = null;
  await env.host.emit('playback:stopped', { reason: 'user' });
  await expect(panel(page)).toContainText('没有正在播放的曲目');
  await expect(panel(page).locator('[data-lyrics-source]')).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('窄窗与减弱动效：面板不越界，模糊关闭，Esc 返回入口焦点', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const env = await openLyrics(page, LOCAL, 720);
  const player = lyricsPlayer(page);
  await expect(player).toBeVisible();
  await expect(player.locator('..')).toHaveAttribute('data-reduced-motion', 'true');
  await expect
    .poll(() =>
      player.locator('[class*="lyricLine"]').evaluateAll((elements) =>
        elements.every((element) => {
          const filter = getComputedStyle(element).filter;
          return filter === 'none' || filter === 'blur(0px)';
        }),
      ),
    )
    .toBe(true);
  const box = await panel(page).boundingBox();
  if (!box) throw new Error('歌词面板未显示');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(720);
  expect(box.height).toBeGreaterThan(300);
  await panel(page).evaluate((element) => {
    const input = document.createElement('input');
    input.dataset['escapeProbe'] = '';
    element.append(input);
    input.focus();
  });
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeVisible();
  await panel(page)
    .locator('[data-escape-probe]')
    .evaluate((input) => input.remove());
  await panel(page).getByRole('switch', { name: '在线歌词' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(key(page)).toBeFocused();
  expect(env.errors).toEqual([]);
});

test('在线底栏随指针活动显示，静止后隐藏，键盘聚焦时保持可见且不挤动歌词', async ({ page }) => {
  const env = await openLyrics(page);
  const controls = panel(page).locator('[data-lyrics-controls]');
  await panel(page).hover();
  await expect(controls).toHaveCSS('opacity', '1');
  const before = await lyricsPlayer(page).boundingBox();
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS('opacity', '0');
  expect(await lyricsPlayer(page).boundingBox()).toEqual(before);
  const online = panel(page).getByRole('switch', { name: '在线歌词' });
  await online.focus();
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(controls).not.toHaveAttribute('data-visible', 'true', { timeout: 5000 });
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(online).toBeFocused();
  const search = controls.getByRole('button', { name: '搜索歌词', exact: true });
  const switchBox = await online.boundingBox();
  const searchBox = await search.boundingBox();
  expect(searchBox && switchBox && searchBox.x > switchBox.x).toBe(true);
  expect(env.errors).toEqual([]);
});

test('设置键进入歌词栏目，两档动效与自定义即时生效，字号独立保存', async ({ page }) => {
  const env = await openLyrics(page);
  const settingsKey = panel(page).getByRole('button', { name: '歌词设置', exact: true });
  await settingsKey.click();
  const settings = page.locator('[data-lyrics-settings]');
  await expect(page.locator('[data-page="settings"]')).toBeVisible();
  await expect(page.locator('#settings-lyrics-title')).toBeFocused();
  await expect(
    page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '歌词', exact: true }),
  ).toBeVisible();
  const preset = settings.getByRole('combobox', { name: '动效预设' });
  await preset.selectOption('winui');
  await expect(lyricsPlayer(page).locator('..')).toHaveAttribute('data-spring', 'off');
  const transition = await lyricsPlayer(page)
    .locator('[class*="lyricLineWrapper"]')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const properties = style.transitionProperty.split(',').map((part) => part.trim());
      return {
        properties,
        duration: style.transitionDuration.split(',')[properties.indexOf('transform')]?.trim(),
      };
    });
  expect(transition.properties).toContain('opacity');
  expect(transition.duration).toBe('0.5s');
  await expect
    .poll(() => env.host.config.get('defaultTheme.lyrics.motion'))
    .toMatchObject({ preset: 'winui' });
  const font = settings.getByRole('spinbutton', { name: '字号 (px)' });
  await font.fill('28');
  await font.press('Enter');
  await expect(lyricsPlayer(page)).toHaveCSS('font-size', '28px');
  await settings.getByRole('switch', { name: '远处歌词模糊' }).check();
  await expect(preset).toHaveValue('custom');
  await preset.selectOption('amll');
  await expect(lyricsPlayer(page).locator('..')).toHaveAttribute('data-spring', 'on');
  await expect(lyricsPlayer(page)).toHaveCSS('font-size', '28px');
  await preset.selectOption('custom');
  await expect(settings.getByRole('switch', { name: '远处歌词模糊' })).toBeChecked();
  await expect(lyricsPlayer(page).locator('..')).toHaveAttribute('data-spring', 'off');
  await panel(page).getByRole('tab', { name: '全文', exact: true }).click();
  const transcript = panel(page).locator('[data-lyrics-transcript]');
  const line = transcript.getByRole('button', { name: '第一句 第一句译文' });
  await expect(line).toHaveCSS('font-size', '14px');
  await expect(line).toHaveAccessibleDescription('0:40');
  await expect(transcript.locator('time')).toHaveText(['0:01', '0:40', '0:45', '0:50']);
  await font.fill('36');
  await font.press('Enter');
  await expect(line).toHaveCSS('font-size', '14px');
  await panel(page).getByRole('tab', { name: '同步', exact: true }).click();
  await expect(lyricsPlayer(page)).toHaveCSS('font-size', '36px');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(settings).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('全部整理与渲染参数落盘，保存失败保留当前值并可重试', async ({ page }) => {
  const env = await openLyrics(page);
  await panel(page).getByRole('button', { name: '歌词设置', exact: true }).click();
  const settings = page.locator('[data-lyrics-settings]');
  await settings.getByText('歌词整理', { exact: true }).click();
  for (const name of [
    '合并连续空格',
    '行时间对齐逐字时间',
    '同步主唱与背景人声时间',
    '清理短暂的时间重叠',
    '提前显示下一句',
  ])
    await settings.getByRole('switch', { name, exact: true }).uncheck();
  await settings
    .getByRole('combobox', { name: '屏蔽已标记的不雅用语' })
    .selectOption('partial-mask');
  await settings.getByRole('textbox', { name: '替换字符' }).fill('#');
  await settings.getByText('渲染', { exact: true }).click();
  await settings.getByRole('switch', { name: '自动识别播放跳转' }).uncheck();
  await settings.getByRole('switch', { name: '背景人声始终放在主唱下方' }).check();
  const overscan = settings.getByRole('spinbutton', { name: '屏外渲染距离 (px)' });
  await overscan.fill('500');
  await overscan.press('Enter');
  await expect
    .poll(() => env.host.config.get('defaultTheme.lyrics.display'))
    .toMatchObject({
      autoSeek: false,
      overscan: 500,
      backgroundLast: true,
      maskMode: 'partial-mask',
      maskChar: '#',
      optimize: {
        normalizeSpaces: false,
        resetLineTimestamps: false,
        syncMainAndBackgroundLines: false,
        cleanUnintentionalOverlaps: false,
        tryAdvanceStartTime: false,
      },
    });
  env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
  await settings.getByRole('switch', { name: '背景人声始终放在主唱下方' }).uncheck();
  await expect(settings).toContainText('设置已生效，但未能保存');
  env.host.answer('config.set', (params) => ({ success: true, key: String(params['key']) }));
  await settings.getByRole('button', { name: '重试保存' }).click();
  await expect(settings).toContainText('已保存');
  expect(env.errors).toEqual([]);
});

test('搜索入口打开候选选择器，选择在线歌词覆盖当前本地词但不写文件', async ({ page }) => {
  const env = await openLyrics(page);
  onlineReplies(env);
  await panel(page).hover();
  await panel(page).getByRole('switch', { name: '在线歌词' }).check();
  await panel(page).getByRole('button', { name: '搜索歌词', exact: true }).click();
  const search = panel(page).locator('[data-lyrics-search]');
  await expect(search.getByRole('textbox')).toHaveCount(1);
  const contentBox = await page.locator('[data-right-card] > [data-page="lyrics"]').boundingBox();
  const searchBox = await search.boundingBox();
  expect(searchBox?.height).toBe(contentBox?.height);
  expect(searchBox?.y).toBe(contentBox?.y);
  await expect(page.locator('[data-right-card-playback-state]')).toBeVisible();
  await expect(page.getByRole('tab', { name: '歌词', exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: '歌词设置' })).toBeHidden();
  const candidate = search.getByRole('radio');
  await expect(candidate).toHaveCount(1);
  await expect(candidate).toHaveAccessibleName(/LRCLIB/);
  const lrclib = env.host
    .callsTo('http.get')
    .find((params) => String(params['url']).includes('lrclib.net'));
  expect(new URL(String(lrclib?.['url'])).searchParams.get('q')).toBe(
    [env.state.track?.title, env.state.track?.artist].filter(Boolean).join(' '),
  );
  await candidate.check();
  await search.getByRole('button', { name: '使用歌词' }).click();
  await expect(search).toHaveCount(0);
  await expect(panel(page).locator('[data-lyrics-source]')).toHaveText('LRCLIB');
  await expect(lyricsPlayer(page).getByText('在线第一句', { exact: true })).toBeVisible();
  expect(env.host.callsTo('lyrics.save')).toHaveLength(0);
  await expect(panel(page).getByRole('button', { name: '搜索歌词', exact: true })).toBeFocused();
  expect(env.errors).toEqual([]);
});

test('单框搜索处理中文组词、清空和失败，窄窗返回保留预览外壳', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const env = await openLyrics(page, LOCAL, 720);
  onlineReplies(env);
  await panel(page).hover();
  await panel(page).getByRole('button', { name: '搜索歌词', exact: true }).click();
  const search = panel(page).locator('[data-lyrics-search]');
  const input = search.getByRole('textbox', { name: '搜索关键词' });
  await expect(input).toBeFocused();
  expect(env.host.callsTo('http.get')).toHaveLength(0);
  await search.getByRole('switch', { name: '在线歌词' }).click();
  await expect(input).toBeFocused();
  await expect(search.getByRole('radio')).toHaveCount(1);
  await search.getByRole('button', { name: '清空搜索' }).click();
  await expect(input).toBeFocused();
  await expect(search.getByRole('radio')).toHaveCount(0);
  const before = env.host.callsTo('http.get').length;
  await input.dispatchEvent('compositionstart');
  await input.fill('周杰');
  await page.waitForTimeout(500);
  expect(env.host.callsTo('http.get')).toHaveLength(before);
  await input.fill('周杰伦 晴天');
  await input.dispatchEvent('compositionend');
  await expect(search.getByRole('radio')).toHaveCount(1);
  env.host.answer('http.get', hostFailure('OPERATION_FAILED'));
  await input.fill('新的关键词');
  await expect(search).toContainText('歌词搜索失败');
  await expect(search).not.toContainText('没有找到匹配的歌词');
  await expect(search).not.toContainText('所选歌词读取失败');
  const box = await search.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 720).toBe(true);
  await search.getByRole('button', { name: '返回歌词' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('[data-right-card-playback-state]')).toBeVisible();
  expect(env.errors).toEqual([]);
});
