import { expect, test, type Page } from '@playwright/test';
import { libraryAnswers } from '../fixtures/albumLibrary.ts';
import { albumRow } from '../fixtures/libraryRows.ts';
import { choosePlayerBar, openPlayer, PLAYING_TRACK } from '../fixtures/playerPage.ts';

test.use({ screenshot: 'off' });

// 播放栏右键菜单里的「转到专辑」「转到艺人」：经对象打开服务，到了之后署名成了当前页，菜单里不再出这一项

const LIBRARY = libraryAnswers([albumRow(PLAYING_TRACK.album, PLAYING_TRACK.albumArtist)]);

async function openBar(page: Page) {
  await choosePlayerBar(page, 'bottom');
  const player = await openPlayer(page, { answers: LIBRARY });
  player.host.answer('menu.getContextMenu', {
    success: true,
    mode: 'handles',
    locale: 'zh-CN',
    i18n: true,
    withAvailability: true,
    items: [],
  });
  const bar = page.locator('[data-player-bar]');
  const menu = page.locator('[data-now-playing-menu]');
  const openMenu = async () => {
    await bar.locator('[data-player-key="cover"]').click({ button: 'right' });
    await expect(menu).toBeVisible();
  };
  return { ...player, bar, menu, openMenu };
}

test('右键菜单「转到艺人」去艺人页；到了之后菜单里不再出这一项', async ({ page }) => {
  const { errors, bar, menu, openMenu } = await openBar(page);
  await openMenu();
  await menu.getByRole('menuitem', { name: '转到艺人', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(
    bar.getByRole('button', { name: PLAYING_TRACK.artist, exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await openMenu();
  await expect(menu.getByRole('menuitem', { name: '转到艺人', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('右键菜单「转到专辑」去专辑详情页；到了之后菜单里不再出这一项', async ({ page }) => {
  const { errors, bar, menu, openMenu } = await openBar(page);
  await openMenu();
  await menu.getByRole('menuitem', { name: '转到专辑', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(bar.getByRole('button', { name: PLAYING_TRACK.album, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await openMenu();
  await expect(menu.getByRole('menuitem', { name: '转到专辑', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
