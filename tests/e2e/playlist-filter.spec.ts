import { guidOf } from '../fixtures/fakePlaylists.ts';
import { expect, test } from '@playwright/test';
import { makePlaylist, makeRow } from '../fixtures/fakePlaylists.ts';
import { listParam } from '../fixtures/hostAnswers.ts';
import { albumTracks, openPlaylist, PLAYLIST_LISTS } from '../fixtures/playlistPage.ts';

// 播放列表页的页内过滤与空态：列表变了按同一个词重扫、进过滤时选中收窄到命中、行菜单加条件与条件行、
// 清空键、⋯ 对命中的操作、离开再回来词与条件都还在、智能列表为空的空态，普通空列表不出空态。键入即过滤与
// 没有匹配的空态在 playlist-page。

test('列表内容变了：按同一个词重扫，框里的词不动', async ({ page }) => {
  const { host, lists, guid, view, row, errors } = await openPlaylist(page, 'Mix');
  const filter = view.getByRole('textbox', { name: '筛选此播放列表' });
  await filter.fill('Mix 1');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
  const tracks = [...Array.from({ length: 12 }, (_, at) => makeRow('Mix', at)), makeRow('Mix', 12)];
  lists.setTracks(guid, tracks);
  await host.emit('playlist:itemsAdded', {
    playlistGuid: guidOf(1),
    playlist: 1,
    start: 12,
    count: 1,
  });
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 5 首');
  await expect(row('Mix 13')).toBeVisible();
  await expect(filter).toHaveValue('Mix 1');
  expect(errors).toEqual([]);
});

test('进过滤前选着的行只留命中的几行，宿主那份跟着收窄；Delete 不删看不见的行', async ({
  page,
}) => {
  const { lists, guid, view, row, errors } = await openPlaylist(page, 'Mix');
  await row('Mix 2').click();
  await page.keyboard.press('Control+A');
  await expect.poll(() => lists.content.selection(guid)).toHaveLength(12);
  const filter = view.getByRole('textbox', { name: '筛选此播放列表' });
  // 逐字敲：词间的空格要留在框里。
  await filter.pressSequentially('Mix 1');
  await expect(filter).toHaveValue('Mix 1');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
  await expect.poll(() => lists.content.selection(guid)).toEqual([0, 9, 10, 11]);
  await row('Mix 10').click({ modifiers: ['Control'] });
  await expect.poll(() => lists.content.selection(guid)).toEqual([0, 10, 11]);
  await page.keyboard.press('Delete');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 1 首');
  await filter.fill('');
  await expect(row('Mix 2')).toBeVisible();
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('9 首');
  expect(errors).toEqual([]);
});

test('行菜单「筛选」加条件：条件行出现、只列命中；清空键只清词，✕ 去掉条件后条件行收起', async ({
  page,
}) => {
  const { view, row, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  const conditions = view.locator('[data-playlist-conditions]');
  const subtitle = view.locator('[data-playlist-subtitle]');
  await expect(conditions).toHaveCount(0);
  await row('Mix 5').click({ button: 'right' });
  await page.locator('[data-playlist-track-menu] [data-action="filter"]').click();
  await expect(page.locator('[data-filter="album"]')).toContainText('Album 2');
  await page.locator('[data-filter="album"]').click();
  await expect(conditions.getByText('专辑 Album 2')).toBeVisible();
  await expect(subtitle).toContainText('匹配 4 首');
  await expect(row('Mix 1')).toHaveCount(0);

  const filter = view.getByRole('textbox', { name: '筛选此播放列表' });
  const clear = view.getByRole('button', { name: '清空输入' });
  await expect(clear).toHaveCount(0);
  await filter.fill('Mix 8');
  await expect(subtitle).toContainText('匹配 1 首');
  await clear.click();
  await expect(filter).toHaveValue('');
  await expect(filter).toBeFocused();
  await expect(subtitle).toContainText('匹配 4 首');

  await view.getByRole('button', { name: '移除「专辑 Album 2」' }).click();
  await expect(conditions).toHaveCount(0);
  await expect(subtitle).not.toContainText('匹配');
  await expect(row('Mix 1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('⋯ 对命中：只保留命中先让宿主选中命中的行再裁剪；发送到新列表按「列表名 · 词」起名', async ({
  page,
}) => {
  const { host, lists, guid, view, errors } = await openPlaylist(page, 'Mix');
  const selectedAtCrop: number[][] = [];
  host.answer('menu.runMainMenuCommand', () => {
    selectedAtCrop.push(lists.content.selection(guid));
    return { success: true };
  });
  await expect(view.getByRole('button', { name: '结果操作' })).toHaveCount(0);
  await view.getByRole('textbox', { name: '筛选此播放列表' }).fill('Mix 1');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
  const more = view.getByRole('button', { name: '结果操作' });
  await more.click();
  const keep = page.locator('[data-action="keep-hits"]');
  await expect(keep).toContainText('移除其余 8 首');
  await keep.click();
  await expect.poll(() => selectedAtCrop).toEqual([[0, 9, 10, 11]]);

  await more.click();
  await page.locator('[data-action="send-hits"]').click();
  await expect.poll(() => host.callsTo('playlist.create')).toMatchObject([{ name: 'Mix · Mix 1' }]);
  await expect
    .poll(() =>
      host.callsTo('playlist.insertTracks').map((call) => listParam(call, 'handles').length),
    )
    .toEqual([4]);
  expect(errors).toEqual([]);
});

test('离开这一页再后退回来：过滤词、条件与过滤后的行都还在', async ({ page }) => {
  const { view, row, entry, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  await view.getByRole('textbox', { name: '筛选此播放列表' }).fill('Mix 1');
  await row('Mix 10').click({ button: 'right' });
  await page.locator('[data-playlist-track-menu] [data-action="filter"]').click();
  await page.locator('[data-filter="artist"]').click();
  await expect(row('Mix 12')).toBeVisible();
  await expect(row('Mix 1')).toHaveCount(0);
  await entry('Default').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Default', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  const back = page.getByRole('region', { name: 'Mix', exact: true });
  await expect(back.getByRole('heading', { level: 1, name: 'Mix', exact: true })).toBeVisible();
  await expect(back.getByRole('textbox', { name: '筛选此播放列表' })).toHaveValue('Mix 1');
  await expect(back.locator('[data-playlist-conditions]').getByText('艺人 Artist 3')).toBeVisible();
  await expect(back.locator('[data-playlist-subtitle]')).toContainText('匹配 3 首');
  await expect(row('Mix 12')).toBeVisible();
  await expect(row('Mix 1')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('智能列表一首都没有时写明「这张智能列表里没有曲目」；普通的空列表不出空态', async ({
  page,
}) => {
  const lists = [
    ...PLAYLIST_LISTS,
    makePlaylist(3, 'Empty Smart', { isAutoplaylist: true, isLocked: true, trackCount: 0 }),
    makePlaylist(4, 'Empty', { trackCount: 0 }),
  ];
  const { entry, view, errors } = await openPlaylist(page, 'Empty Smart', [], lists);
  await expect(view.locator('[data-playlist-empty="auto"]')).toHaveText('此自动播放列表中没有曲目');
  await entry('Empty').click();
  // 换页的动效里离场的那一页还在，按页名认。
  const plain = page.getByRole('region', { name: 'Empty', exact: true });
  await expect(plain.getByRole('heading', { level: 1, name: 'Empty', exact: true })).toBeVisible();
  await expect(plain.locator('[data-playlist-subtitle]')).toContainText('0 首');
  await expect(plain.locator('[data-playlist-empty]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
