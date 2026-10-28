import { expect, test, type Locator } from '@playwright/test';
import { hoverPaintLayers } from '../fixtures/hoverLayers.ts';
import { openFolders } from '../fixtures/foldersPage.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';
import { openSongs } from '../fixtures/songsPage.ts';

// 同一个控件的悬停底色只画在一层，浓度是状态层的一档（前景色 10%）。Fluent 的复合控件常在根上画一层、
// 槽里再继承一层，只改其中一层会叠成内外两个框，浓度翻倍

async function expectSingleLayer(target: Locator): Promise<void> {
  const layers = await hoverPaintLayers(target);
  expect(
    layers.map((layer) => `${layer.tag}[${layer.role ?? ''}] ${layer.background}`),
  ).toHaveLength(1);
  expect(layers[0]?.alpha).toBeLessThanOrEqual(0.15);
}

test('歌曲页：列头、行与视图面板的分段按钮悬停只画一层', async ({ page }) => {
  const songs = await openSongs(page);
  await expectSingleLayer(songs.view.locator('[role="columnheader"][data-column-id="title"]'));
  await expectSingleLayer(songs.view.locator('[role="row"]').nth(3));
  await songs.view.locator('[data-songs-view]').click();
  await expectSingleLayer(page.getByRole('tab', { name: '宽松', exact: true }));
});

test('文件夹页：列头与目录树条目悬停只画一层', async ({ page }) => {
  const env = await openFolders(page);
  await expectSingleLayer(env.folder('Alpha'));
  await env.folder('Music').click();
  await expectSingleLayer(env.grid.locator('[role="columnheader"][data-column-id="title"]'));
});

test('播放列表页：列头与行悬停只画一层', async ({ page }) => {
  const list = await openPlaylist(page, 'Mix');
  await expectSingleLayer(list.grid.locator('[role="columnheader"][data-column-id="title"]'));
  await expectSingleLayer(list.grid.getByRole('row').nth(3));
});
