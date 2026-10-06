import { expect, test, type Page } from '@playwright/test';
import { BIOGRAPHY_PREFS_KEY } from '../../src/library/biography/biographyPrefs.ts';
import { LASTFM_KEY_PREF } from '../../src/library/biography/lastfm-api/lastfmKey.ts';
import { openArtists } from '../fixtures/artistsPage.ts';
import { apiReply, artistInfoSample } from '../fixtures/lastfmApiSamples.ts';
import { artistSample, NUJABES } from '../fixtures/musicbrainzSamples.ts';
import type { PageHost } from '../fixtures/pageHost.ts';
import { PLAYER_BAR_STORAGE_KEY } from '../../src/theme/playerBarStyle.ts';
import { makeTrack } from '../fixtures/tracks.ts';

async function start(
  page: Page,
  dimensions: readonly (readonly [number, number])[] = [
    [128, 160],
    [128, 160],
  ],
  configure?: (host: PageHost, pictures: readonly string[]) => void,
) {
  const pictures = await page.evaluate(
    (sizes) =>
      sizes.map(([width, height], index) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('缺少绘图上下文');
        context.fillStyle = index === 0 ? '#445566' : '#aa7766';
        context.fillRect(0, 0, width, height);
        return canvas.toDataURL('image/png');
      }),
    dimensions,
  );
  const env = await openArtists(page, 1280, (host) => {
    host.config.set(BIOGRAPHY_PREFS_KEY, {
      version: 1,
      enabled: true,
      language: 'zh',
      identities: [{ artist: 'Nujabes', sourceArtist: 'Nujabes', mbid: NUJABES }],
    });
    host.config.set(LASTFM_KEY_PREF.key, '0123456789abcdef0123456789abcdef');
    host.answer('http.get', (params) => {
      const url = new URL(String(params['url']));
      if (url.hostname === 'musicbrainz.org')
        return apiReply(artistSample(NUJABES, { area: { name: '日本' } }));
      const method = url.searchParams.get('method');
      if (method === 'artist.getInfo')
        return apiReply(
          artistInfoSample(
            'Nujabes',
            `${'这是一段需要完整省略的简介文字，保留原文的段落与链接。'.repeat(18)}\n\n<a href="https://example.com/label">制作页面</a>\nhttps://example.com/artist`,
          ),
        );
      if (method === 'artist.getTopTracks')
        return apiReply({
          toptracks: {
            track: [
              {
                name: 'Feather',
                playcount: '1200',
                listeners: '100',
                url: 'https://www.last.fm/music/Nujabes/_/Feather',
                '@attr': { rank: '1' },
              },
              {
                name: 'Outside',
                playcount: '800',
                listeners: '80',
                url: 'https://www.last.fm/music/Nujabes/_/Outside',
                '@attr': { rank: '2' },
              },
            ],
          },
        });
      return apiReply({});
    });
    host.answer('artwork.getForTrack', (params) => ({
      success: true,
      available: true,
      type: 'artist',
      path: String(params['path']),
      dataUrl: pictures[String(params['path']).includes('Modal Soul') ? 1 : 0] ?? '',
    }));
    host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: String(params['type']),
      path: String(params['path']),
      dataUrl: pictures[String(params['path']).includes('Modal Soul') ? 1 : 0] ?? '',
    }));
    host.answer('titleformat.evalBatch', (params) => {
      const paths = Array.isArray(params['paths'])
        ? params['paths'].filter((path): path is string => typeof path === 'string')
        : [];
      return {
        success: true,
        pattern: String(params['pattern']),
        total: paths.length,
        successCount: paths.length,
        errorCount: 0,
        results: paths.map((path) => ({
          path,
          success: true,
          result: path.includes('Feather') ? '41' : '3',
        })),
      };
    });
    host.answer('shell.openExternal', { success: true });
    configure?.(host, pictures);
  });
  await env.artist('Nujabes').click();
  await expect(env.view.locator('[data-biography-article]')).toBeVisible();
  return { ...env, pictures };
}

test('简介默认全文、资料字段块和末尾来源，没有折叠操作', async ({ page }) => {
  const env = await start(page);
  const about = env.view.locator('[data-artist-about]');
  const article = about.locator('[data-biography-article]');
  const text = article.locator('p').first().locator('..');
  await expect(text).toHaveCSS('-webkit-line-clamp', 'none');
  expect(await text.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  await expect(about.locator('[data-biography-sources]')).toHaveCount(1);
  await expect(about.getByRole('button', { name: '更多', exact: true })).toHaveCount(0);
  await expect(article.locator('[data-folding]')).toHaveCount(0);
  const facts = about.getByRole('region', { name: '资料' }).locator('dl');
  await expect(facts.getByText('日本', { exact: true })).toBeVisible();
  expect(
    await facts.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBe(3);
  const count = facts
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: 'Last.fm 听众' }) });
  expect(
    await count.evaluate((node) => {
      const label = node.querySelector('dt')?.getBoundingClientRect();
      const value = node.querySelector('dd')?.getBoundingClientRect();
      return !!label && !!value && value.top >= label.bottom && value.left === label.left;
    }),
  ).toBe(true);
  expect(
    await about
      .locator('[data-biography-sources]')
      .evaluate((node) => node.nextElementSibling === null),
  ).toBe(true);
  expect(env.errors).toEqual([]);
});

test('正文超链接先确认，取消不打开，记住选择后直接经 SDK 打开', async ({ page }) => {
  const env = await start(page);
  const about = env.view.locator('[data-artist-about]');
  const link = about.getByRole('link', { name: '制作页面', exact: true });
  await link.click();
  const dialog = page.getByRole('dialog', { name: '访问外部链接？' });
  await expect(dialog).toContainText('https://example.com/label');
  expect(env.host.callsTo('shell.openExternal')).toEqual([]);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(env.host.callsTo('shell.openExternal')).toEqual([]);
  await link.click();
  await dialog.getByRole('checkbox', { name: '不再提醒' }).check();
  await dialog.getByRole('button', { name: '打开链接', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => env.host.config.get('defaultTheme.links.confirmExternal')).toBe(false);
  await about.getByRole('link', { name: 'https://example.com/artist', exact: true }).click();
  await expect
    .poll(() => env.host.callsTo('shell.openExternal').at(-1)?.['url'])
    .toBe('https://example.com/artist');
  await expect(dialog).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('常听与热门的本地条目使用曲目表选择、键盘和右键菜单', async ({ page }) => {
  const env = await start(page);
  const highlights = env.view.getByRole('region', { name: '常听', exact: true });
  const played = env.view.getByRole('treegrid', { name: '常听', exact: true });
  await expect(played).toBeVisible();
  await expect(highlights.getByRole('button', { name: '显示更多', exact: true })).toHaveCount(0);
  const feather = played.getByRole('row').filter({ hasText: 'Feather' });
  await expect(feather).toBeVisible();
  await feather.click();
  await expect(feather).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(played.locator('[data-row-focus="true"]')).not.toContainText('Feather');
  await feather.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '播放', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await env.view.getByRole('tab', { name: '热门', exact: true }).click();
  await expect(
    env.view
      .getByRole('treegrid', { name: '热门', exact: true })
      .getByText('Feather', { exact: true }),
  ).toBeVisible();
  await env.view.getByRole('button', { name: 'Outside' }).click();
  await expect(page.getByRole('dialog', { name: '访问外部链接？' })).toContainText('/Outside');
  expect(env.host.callsTo('shell.openExternal')).toEqual([]);
  await page
    .getByRole('dialog', { name: '访问外部链接？' })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(highlights.locator('[data-artist-highlights-scroll]')).toHaveCSS(
    'max-height',
    '240px',
  );
  await expect(highlights.locator('[data-artist-highlights-scroll]')).toHaveCSS(
    'overflow-y',
    'auto',
  );
  await expect(env.view.getByRole('treegrid', { name: '热门', exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('热门长标题省略但外链图标始终可见，播放次数不重叠', async ({ page }) => {
  const env = await start(page, undefined, (host) => {
    host.answer('http.get', (params) => {
      const url = new URL(String(params['url']));
      if (url.searchParams.get('method') === 'artist.getInfo')
        return apiReply(artistInfoSample('Nujabes', '简介正文'));
      if (url.searchParams.get('method') === 'artist.getTopTracks')
        return apiReply({
          toptracks: {
            track: [1, 2, 3].map((rank) => ({
              name: `Very long recording title with extended edition and additional credits ${rank}`,
              playcount: '6600000',
              listeners: '100',
              '@attr': { rank: String(rank) },
              url: `https://www.last.fm/music/Nujabes/_/Recording${rank}`,
            })),
          },
        });
      return apiReply({});
    });
  });
  await env.view.getByRole('tab', { name: '热门', exact: true }).click();
  const rows = env.view.locator('[data-artist-external-track]');
  await expect(rows).toHaveCount(3);
  for (const width of [1280, 1008, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await rows.evaluateAll((nodes) =>
        nodes.every((node) => {
          const link = node.querySelector('[title]')?.getBoundingClientRect();
          const count = node.lastElementChild?.getBoundingClientRect();
          const icon = node.querySelector('[title] svg')?.getBoundingClientRect();
          return (
            link &&
            count &&
            icon &&
            icon.width >= 15 &&
            icon.left >= link.left &&
            icon.right <= link.right + 1 &&
            link.right <= count.left &&
            node.scrollWidth <= node.clientWidth
          );
        }),
      ),
    ).toBe(true);
  }
  expect(env.errors).toEqual([]);
});

test('无主图时从相册取多张照片，返回艺人页不重复请求', async ({ page }) => {
  const ids = ['1234567890abcdef1234567890abcdef', 'abcdef1234567890abcdef1234567890'];
  const env = await start(page, undefined, (host, pictures) => {
    host.answer('artwork.getForTrack', {
      success: true,
      available: false,
      type: 'artist',
      path: '',
    });
    host.answer('http.get', (params) => {
      const url = new URL(String(params['url']));
      if (url.hostname === 'lastfm-img.freetls.fastly.net')
        return {
          success: true,
          status: 200,
          responseType: 'base64',
          headers: { 'Content-Type': 'image/png' },
          body: pictures[url.pathname.includes(ids[0]!) ? 0 : 1]?.split(',')[1] ?? '',
        };
      if (url.pathname.endsWith('/+images'))
        return {
          success: true,
          status: 200,
          responseType: 'text',
          headers: {},
          body: `<link rel="canonical" href="${url.href}"><ul class="image-list">${ids
            .map(
              (id) =>
                `<li><a href="/music/Nujabes/+images/${id}"><img src="https://lastfm-img.freetls.fastly.net/i/u/300x300/${id}.jpg"></a></li>`,
            )
            .join('')}</ul>`,
        };
      if (url.searchParams.get('method') === 'artist.getInfo')
        return apiReply(artistInfoSample('Nujabes', '相册没有依赖主图'));
      return apiReply({});
    });
  });
  const photos = env.view.locator('[data-artist-about]').getByRole('region', { name: '艺人照片' });
  await expect(photos.getByRole('button', { name: /^照片 \d/ })).toHaveCount(2);
  const downloads = () =>
    env.host.callsTo('http.get').filter((call) => String(call['url']).includes('lastfm-img.'));
  expect(downloads()).toHaveLength(2);
  await photos.getByRole('button', { name: '照片 2', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Nujabes', exact: true });
  await expect(viewer).toBeVisible();
  expect(
    await viewer
      .locator('img')
      .first()
      .evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await env.view
    .locator('[data-artist-albums]')
    .getByRole('button', { name: /Modal Soul/ })
    .click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(photos.getByRole('button', { name: /^照片 \d/ })).toHaveCount(2);
  expect(downloads()).toHaveLength(2);
  expect(env.errors).toEqual([]);
});

for (const colorScheme of ['dark', 'light'] as const)
  test(`${colorScheme} 查看器操作在顶部，浏览照片不改头像`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const env = await start(page);
    const trigger = env.view.getByRole('button', { name: '打开艺人照片', exact: true });
    const foreground = trigger.locator('[data-artist-photo-foreground]');
    await expect(trigger.locator('[data-artist-photo-state="ready"]')).toBeVisible();
    const before = await foreground.getAttribute('src');
    await trigger.click();
    const viewer = page.getByRole('dialog', { name: 'Nujabes', exact: true });
    await expect(viewer).toBeVisible();
    expect(await viewer.evaluate((node) => getComputedStyle(node).backgroundColor)).toContain(
      '0.95',
    );
    await expect(
      viewer.locator('header').getByRole('button', { name: '设为头像', exact: true }),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: '下一张照片' })).toBeEnabled();
    await page.keyboard.press('ArrowRight');
    await expect(foreground).toHaveAttribute('src', before ?? '');
    await viewer.getByRole('button', { name: '设为头像', exact: true }).click();
    await expect(foreground).not.toHaveAttribute('src', before ?? '');
    await viewer.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '恢复自动选择头像', exact: true }).click();
    await expect(foreground).toHaveAttribute('src', before ?? '');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(env.errors).toEqual([]);
  });

for (const [label, width, height] of [
  ['竖幅', 128, 192],
  ['方图', 192, 192],
  ['大方图', 1024, 1024],
  ['横幅', 320, 180],
  ['极宽', 960, 120],
] as const) {
  test(`${label}照片保持比例，详情宽度控制横幅高度和操作换行`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: label === '方图' ? 'light' : 'dark' });
    const env = await start(page, [
      [width, height],
      [128, 160],
    ]);
    const header = env.view.locator('[data-artist-header]');
    const trigger = header.getByRole('button', { name: '打开艺人照片', exact: true });
    const foreground = trigger.locator('[data-artist-photo-foreground]');
    await expect(trigger.locator('[data-artist-photo-state="ready"]')).toBeVisible();
    await expect(foreground).toHaveAttribute('src', env.pictures[0]);
    expect(
      await foreground.evaluate(
        (image, size) =>
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth === size.width &&
          image.naturalHeight === size.height,
        { width, height },
      ),
    ).toBe(true);
    for (const viewport of [1280, 1008, 390]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      await expect(trigger).toHaveCSS('height', viewport === 1280 ? '306px' : '216px');
      await expect(foreground).toHaveCSS('object-fit', 'contain');
      const background = trigger.locator('img[aria-hidden="true"]');
      await expect(background).toHaveAttribute('src', env.pictures[0]);
      expect(await background.evaluate((node) => getComputedStyle(node).filter)).toContain('blur');
      const photoBox = await trigger.boundingBox();
      const imageBox = await foreground.boundingBox();
      expect(photoBox).not.toBeNull();
      expect(imageBox).not.toBeNull();
      if (photoBox && imageBox) {
        expect(imageBox.x).toBeGreaterThanOrEqual(photoBox.x - 1);
        expect(imageBox.y).toBeGreaterThanOrEqual(photoBox.y - 1);
        expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(photoBox.x + photoBox.width + 1);
        expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(photoBox.y + photoBox.height + 1);
        const scale = Math.min(photoBox.width / width, photoBox.height / height);
        expect(imageBox.width).toBeCloseTo(width * scale, 0);
        expect(imageBox.height).toBeCloseTo(photoBox.height, 0);
        expect(imageBox.x + imageBox.width / 2).toBeCloseTo(photoBox.x + photoBox.width / 2, 0);
      }
      const nameBox = await header.getByRole('heading', { name: 'Nujabes' }).boundingBox();
      const playBox = await header.getByRole('button', { name: '播放', exact: true }).boundingBox();
      expect(photoBox && nameBox && nameBox.y >= photoBox.y + photoBox.height).toBe(true);
      expect(photoBox && playBox && playBox.y >= photoBox.y + photoBox.height).toBe(true);
      expect(await header.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(env.errors).toEqual([]);
  });
}

test('旧照片加载失败不能覆盖新头像，关闭查看器回到原入口', async ({ page }) => {
  let release = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/delayed-artist.png', async (route) => {
    await delayed;
    await route.fulfill({ contentType: 'image/png', body: 'invalid image' });
  });
  const env = await start(page, undefined, (host, pictures) => {
    host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: String(params['type']),
      path: String(params['path']),
      dataUrl:
        params['type'] === 'artist' && String(params['path']).includes('Metaphorical')
          ? '/delayed-artist.png'
          : (pictures[1] ?? ''),
    }));
  });
  const trigger = env.view.getByRole('button', { name: '打开艺人照片', exact: true });
  await expect(trigger.locator('[data-artist-photo-state="loading"]')).toBeVisible();
  await trigger.click();
  const viewer = page.getByRole('dialog', { name: 'Nujabes', exact: true });
  await expect(viewer.getByRole('button', { name: '下一张照片' })).toBeEnabled();
  await page.keyboard.press('ArrowRight');
  await viewer.getByRole('button', { name: '设为头像', exact: true }).click();
  await expect(trigger.locator('[data-artist-photo-state="ready"]')).toBeVisible();
  release();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger.locator('[data-artist-photo-state="ready"]')).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('390 胶囊下详情底部保留补偿，照片工具入口可用', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'capsule'), PLAYER_BAR_STORAGE_KEY);
  // 宿主正放着一首：没有当前曲目时胶囊不出。
  const env = await start(page, undefined, (host) => {
    host.answer('playback.getState', {
      success: true,
      state: 'playing',
      canSeek: true,
      canPause: true,
    });
    host.answer('playback.getCurrentTrack', { success: true, found: true, track: makeTrack() });
  });
  await page.setViewportSize({ width: 390, height: 800 });
  const header = env.view.locator('[data-artist-header]');
  await expect(header.locator('[data-artist-photo-state="ready"]')).toBeVisible();
  const photos = header.getByRole('button', { name: '艺人照片', exact: true });
  await photos.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-biography-viewer]')).toHaveCount(0);
  await expect(photos).toBeFocused();
  const last = env.view.locator('[data-artist-albums] li').last();
  await last.scrollIntoViewIfNeeded();
  await header.evaluate((node) => {
    if (node.parentElement) node.parentElement.scrollTop = node.parentElement.scrollHeight;
  });
  const rowBox = await last.boundingBox();
  const capsuleBox = await page.locator('[data-player-capsule]').boundingBox();
  expect(rowBox && capsuleBox && rowBox.y + rowBox.height <= capsuleBox.y).toBe(true);
  expect(env.errors).toEqual([]);
});

test('坏图显示占位，选择正常照片后恢复；切人不保留旧照片', async ({ page }) => {
  await page.route('**/broken-artist.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: 'invalid image' }),
  );
  const env = await start(page, undefined, (host, pictures) => {
    host.answer('artwork.getFb2kUrlByPath', (params) => ({
      success: true,
      available: true,
      type: String(params['type']),
      path: String(params['path']),
      dataUrl:
        params['type'] === 'artist' && String(params['path']).includes('Metaphorical')
          ? '/broken-artist.png'
          : (pictures[1] ?? ''),
    }));
  });
  const header = env.view.locator('[data-artist-header]');
  const trigger = header.getByRole('button', { name: '打开艺人照片', exact: true });
  await expect(header.locator('[data-artist-photo-state="failed"]')).toBeVisible();
  await expect(trigger.locator('img')).toHaveCount(0);
  await expect(trigger.getByRole('img', { name: '照片加载失败' })).toBeVisible();
  await trigger.click();
  const viewer = page.getByRole('dialog', { name: 'Nujabes', exact: true });
  await expect(viewer.getByRole('button', { name: '下一张照片' })).toBeEnabled();
  await page.keyboard.press('ArrowRight');
  await viewer.getByRole('button', { name: '设为头像', exact: true }).click();
  await expect(header.locator('[data-artist-photo-state="ready"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const held = env.host.hold('artwork.getForTrack');
  await env.artist('Shing02').click();
  await expect(header.getByRole('heading', { name: 'Shing02' })).toBeVisible();
  await expect(header.locator('[data-artist-photo-foreground]')).toHaveCount(0);
  held.release();
  await expect(header.locator('[data-artist-photo-foreground]')).toHaveAttribute('alt', 'Shing02');
  expect(env.errors).toEqual([]);
});
