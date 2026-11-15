import { expect, test } from '@playwright/test';
import { selectLastfmSource } from '../fixtures/biographySource.ts';
import { openArtists } from '../fixtures/artistsPage.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { BIOGRAPHY_PREFS_KEY } from '../../src/library/biography/biographyPrefs.ts';
import { LASTFM_KEY_PREF } from '../../src/library/biography/lastfm-api/lastfmKey.ts';
import { apiReply, artistInfoSample } from '../fixtures/lastfmApiSamples.ts';
import { artistAlbumTracks } from '../fixtures/artistsLibrary.ts';

test('墙上的排序字段、方向与列出依据独立选择', async ({ page }) => {
  const env = await openArtists(page);
  const sort = env.view.getByRole('button', { name: '排序与艺人来源' });
  await sort.click();
  await page.getByRole('menuitemradio', { name: '专辑数', exact: true }).click();
  await expect(sort).toContainText('专辑数');
  await sort.click();
  await page.getByRole('menuitemradio', { name: '降序', exact: true }).click();
  await sort.click();
  await expect(page.getByRole('menuitemradio', { name: '专辑数', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('menuitemradio', { name: '降序', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByText('列出依据', { exact: true })).toBeVisible();
  await page.getByRole('menuitemradio', { name: '曲目艺人', exact: true }).click();
  await sort.click();
  await expect(page.getByRole('menuitemradio', { name: '曲目艺人', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(env.errors).toEqual([]);
});

test('墙上打开艺人详情、后退回墙与筛选 @smoke', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const env = await openArtists(page);
  await expect(env.artist('Shing02')).toBeVisible();
  await env.artist('Nujabes').click();
  await expect(env.view.getByRole('heading', { name: 'Nujabes', exact: true })).toBeVisible();
  const albums = env.view.locator('[data-artist-albums]');
  await expect(albums.getByRole('button', { name: /Metaphorical Music/ })).toBeVisible();
  await expect(albums.getByText('Lady Brown', { exact: true })).toHaveCount(0);
  await expect(env.view.locator('[data-artist-albums="guest"]')).toContainText('Luv(sic) Hexalogy');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.wall).toBeVisible();
  await env.view.getByRole('textbox', { name: '筛选艺人' }).fill('Shing');
  await expect(env.artist('Nujabes')).toHaveCount(0);
  await env.artist('Shing02').click();
  await expect(env.view.getByRole('heading', { name: 'Shing02', exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('在详情页点侧边栏「艺人」回到墙，后退依次回到详情与墙', async ({ page }) => {
  const env = await openArtists(page);
  await env.artist('Nujabes').click();
  const heading = env.view.getByRole('heading', { name: 'Nujabes', exact: true });
  await expect(heading).toBeVisible();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '艺人', exact: true })
    .click();
  await expect(env.wall).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(heading).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.wall).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('重取失败保留旧曲目并提示，恢复后清掉错误', async ({ page }) => {
  const env = await openArtists(page);
  await env.artist('Nujabes').click();
  await expect(
    env.view.locator('[data-artist-albums]').getByText('Metaphorical Music', { exact: true }),
  ).toBeVisible();
  env.host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
  await env.host.emit('library:itemsModified', {
    count: 1,
    handles: [],
    truncated: false,
    fromHook: false,
    timestamp: Date.now(),
  });
  await expect(env.view.getByText('刷新失败，显示上次读取的曲目')).toBeVisible();
  await expect(
    env.view.locator('[data-artist-albums]').getByText('Metaphorical Music', { exact: true }),
  ).toBeVisible();
  env.host.answer('library.getAlbumTracks', artistAlbumTracks);
  await env.view.getByRole('button', { name: '重试', exact: true }).click();
  await expect(env.view.getByText('刷新失败，显示上次读取的曲目')).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('专辑条目打开已有详情，后退恢复艺人主体', async ({ page }) => {
  const env = await openArtists(page);
  await env.artist('Nujabes').click();
  await env.view
    .locator('[data-artist-albums]')
    .getByRole('button', { name: /Modal Soul/ })
    .click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.view.getByRole('heading', { name: 'Nujabes', exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('关于按所选艺人取 API 正文，切人后不保留上一位正文', async ({ page }) => {
  const env = await openArtists(page, 1280, (host) => {
    host.config.set(BIOGRAPHY_PREFS_KEY, {
      version: 1,
      enabled: true,
      language: 'zh',
      identities: ['Nujabes', 'Shing02'].map((artist) => ({ artist, sourceArtist: artist })),
    });
    selectLastfmSource(host);
    host.config.set(LASTFM_KEY_PREF.key, '0123456789abcdef0123456789abcdef');
    host.answer('http.get', (params) => {
      const url = new URL(String(params['url']));
      const artist = url.searchParams.get('artist') ?? '';
      return apiReply(
        url.searchParams.get('method') === 'artist.getInfo'
          ? artistInfoSample(artist, `${artist} 的正文`)
          : {},
      );
    });
  });
  await env.artist('Nujabes').click();
  await expect(env.view.getByText('Nujabes 的正文', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await env.artist('Shing02').click();
  await expect(env.view.getByText('Shing02 的正文', { exact: true })).toBeVisible();
  await expect(env.view.getByText('Nujabes 的正文', { exact: true })).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('署名口径改名先显示单值与多值分界，取消不写标签', async ({ page }) => {
  const env = await openArtists(page);
  await env.view.getByRole('button', { name: '排序与艺人来源' }).click();
  await page.getByRole('menuitemradio', { name: '曲目艺人', exact: true }).click();
  await env.artist('Nujabes').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重命名艺人' });
  await expect(dialog.getByRole('button', { name: '重命名', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '编辑跳过曲目的属性' })).toBeVisible();
  await expect(
    dialog.getByText('共 5 首曲目，将修改 2 首；3 首包含多位艺人，保持不变。'),
  ).toBeVisible();
  env.host.answer('menu.getContextMenu', hostFailure('OPERATION_FAILED'));
  await dialog.getByRole('button', { name: '编辑跳过曲目的属性' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('曲目属性打开失败');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(env.host.callsTo('metadata.write')).toEqual([]);
  expect(env.errors).toEqual([]);
});

test('没有照片时头像画人像占位且不拿专辑封面凑，仍可播放；合辑同样没有照片入口', async ({
  page,
}) => {
  const env = await openArtists(page, 1280, (host) => {
    host.answer('artwork.getForTrack', (params) => ({
      success: true,
      available: false,
      type: 'artist',
      path: String(params['path']),
      dataUrl: '',
    }));
  });
  await env.artist('Nujabes').click();
  const header = env.view.locator('[data-artist-header]');
  const avatar = header.getByRole('button', { name: '打开艺人照片', exact: true });
  await expect(avatar).toHaveAttribute('data-artist-photo-state', 'empty');
  await expect(avatar).toBeDisabled();
  await expect(header.locator('[data-song-art]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(header.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(header.getByRole('button', { name: '艺人照片', exact: true })).toBeDisabled();
  await header.getByRole('button', { name: '更多', exact: true }).click();
  await page.locator('[data-action="compilation"]').click();
  await expect(header.getByRole('button', { name: '艺人照片', exact: true })).toHaveCount(0);
  await expect(avatar).toHaveAttribute('data-artist-photo-state', 'empty');
  await expect(header.locator('[data-song-art]')).toHaveCount(0);
  await expect(env.view.getByRole('region', { name: '常听', exact: true })).toHaveCount(0);
  expect(env.errors).toEqual([]);
});
