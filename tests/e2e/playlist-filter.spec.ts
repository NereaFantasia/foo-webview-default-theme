import { guidOf } from '../fixtures/fakePlaylists.ts';
import { expect, test } from '@playwright/test';
import { makePlaylist, makeRow } from '../fixtures/fakePlaylists.ts';
import { listParam } from '../fixtures/hostAnswers.ts';
import { albumTracks, openPlaylist, PLAYLIST_LISTS } from '../fixtures/playlistPage.ts';

// 播放列表页的页内筛选与空态：列表变了按同一个词重算、进过滤时选中收窄到命中、行菜单加条件与条件行、
// 筛选键里的预设与分面、清空键、⋯ 对命中的操作、离开再回来词、预设与条件都还在、筛选态下分组置灰、
// 智能列表为空的空态，普通空列表不出空态。键入即过滤与没有匹配的空态在 playlist-page
// 筛选的求值全在宿主：宿主替身里内置了只覆盖主题会生成的那部分查询语法的求值器

test('列表内容变了：按同一个词重扫，框里的词不动', async ({ page }) => {
  const { host, lists, guid, view, row, errors } = await openPlaylist(page, 'Mix');
  const filter = view.getByRole('searchbox', { name: '在此播放列表中搜索' });
  await filter.pressSequentially('Mix 1');
  await expect(filter).toHaveValue('Mix 1');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
  const tracks = [...Array.from({ length: 12 }, (_, at) => makeRow('Mix', at)), makeRow('Mix', 12)];
  lists.setTracks(guid, tracks);
  await host.emit('playlist:itemsAdded', {
    playlistGuid: guidOf(1),
    playlist: 1,
    start: 12,
    count: 1,
    contentVersion: '1',
  });
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 5 首');
  await expect(row('Mix 13')).toBeVisible();
  await expect(filter).toHaveValue('Mix 1');
  expect(errors).toEqual([]);
});

test('高级查询交宿主求值：只列命中的行；认不出时留着上一份并出提示条；两种模式各留一份草稿', async ({
  page,
}) => {
  const { view, row, errors } = await openPlaylist(page, 'Mix');
  const filter = view.getByRole('searchbox', { name: '在此播放列表中搜索' });
  const subtitle = view.locator('[data-playlist-subtitle]');
  const mode = view.locator('[data-query-scope]');
  await filter.fill('Mix 1');
  await expect(subtitle).toContainText('匹配 4 首');
  await mode.click();
  await page.locator('[data-query-mode="advanced"]').click();
  await expect(filter).toHaveValue('');
  await filter.fill('title HAS "Mix 2"');
  await filter.press('Enter');
  await expect(subtitle).toContainText('匹配 1 首');
  await expect(row('Mix 2')).toBeVisible();
  await expect(row('Mix 1')).toHaveCount(0);

  await filter.fill('oops');
  await filter.press('Enter');
  await expect(view.locator('[data-query-invalid]')).toBeVisible();
  await expect(subtitle).toContainText('匹配 1 首');
  await expect(row('Mix 2')).toBeVisible();
  await view.locator('[data-query-invalid] button').click();
  await expect(page.locator('[data-syntax-reference]')).toBeVisible();

  await page.keyboard.press('Escape');
  await mode.click();
  await page.locator('[data-query-mode="text"]').click();
  await expect(filter).toHaveValue('Mix 1');
  await expect(subtitle).toContainText('匹配 4 首');
  await expect(view.locator('[data-query-invalid]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('多选后从行菜单筛选，只保留命中的选中行；Delete 不删看不见的行', async ({ page }) => {
  const { lists, guid, view, row, errors } = await openPlaylist(
    page,
    'Mix',
    albumTracks('Mix', 3, 4),
  );
  await row('Mix 2').click();
  await page.keyboard.press('Control+A');
  await expect.poll(() => lists.content.selection(guid)).toHaveLength(12);
  await row('Mix 2').click({ button: 'right' });
  await page.locator('[data-playlist-track-menu] [data-action="filter"]').click();
  await page.locator('[data-filter="album"]').click();
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
  await expect.poll(() => lists.content.selection(guid)).toEqual([0, 1, 2, 3]);
  await row('Mix 2').click({ modifiers: ['Control'] });
  await expect.poll(() => lists.content.selection(guid)).toEqual([0, 2, 3]);
  await page.keyboard.press('Delete');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 1 首');
  await view.getByRole('button', { name: '移除「专辑 · 等于 Album 1」' }).click();
  await expect(row('Mix 2')).toBeVisible();
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('9 首');
  expect(errors).toEqual([]);
});

test('行菜单「筛选」加条件：条件行出现、只列命中；清空键只清词，✕ 去掉条件后条件行收起', async ({
  page,
}) => {
  const { view, row, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  const conditions = view.locator('[data-query-conditions]');
  const subtitle = view.locator('[data-playlist-subtitle]');
  await expect(conditions).toHaveCount(0);
  await row('Mix 5').click({ button: 'right' });
  await page.locator('[data-playlist-track-menu] [data-action="filter"]').click();
  await expect(page.locator('[data-filter="album"]')).toContainText('Album 2');
  await page.locator('[data-filter="album"]').click();
  await expect(conditions.getByText('专辑 · 等于 Album 2')).toBeVisible();
  await expect(subtitle).toContainText('匹配 4 首');
  await expect(row('Mix 1')).toHaveCount(0);

  const filter = view.getByRole('searchbox', { name: '在此播放列表中搜索' });
  const clear = view.getByRole('button', { name: '清空输入' });
  await expect(clear).toHaveCount(0);
  await filter.fill('Mix 8');
  await expect(subtitle).toContainText('匹配 1 首');
  await clear.click();
  await expect(filter).toHaveValue('');
  await expect(filter).toBeFocused();
  await expect(subtitle).toContainText('匹配 4 首');

  await view.getByRole('button', { name: '移除「专辑 · 等于 Album 2」' }).click();
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
    return { success: true, completion: 'unknown' };
  });
  const more = view.locator('[data-playlist-more]');
  await more.click();
  await expect(page.locator('[data-action="keep-hits"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await view.getByRole('searchbox', { name: '在此播放列表中搜索' }).fill('Mix 1');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
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
  await view.getByRole('searchbox', { name: '在此播放列表中搜索' }).fill('Mix 1');
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
  await expect(back.getByRole('searchbox', { name: '在此播放列表中搜索' })).toHaveValue('Mix 1');
  await expect(
    back.locator('[data-query-conditions]').getByText('艺人 · 等于 Artist 3'),
  ).toBeVisible();
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
  // 换页的动效里离场的那一页还在，按页名认
  const plain = page.getByRole('region', { name: 'Empty', exact: true });
  await expect(plain.getByRole('heading', { level: 1, name: 'Empty', exact: true })).toBeVisible();
  await expect(plain.locator('[data-playlist-subtitle]')).toContainText('0 首');
  await expect(plain.locator('[data-playlist-empty]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** 评分 0 到 5 轮着来、流派 Rock 与 Jazz 交替的一张列表，预设与分面有东西可筛 */
const rated = (list: string, count: number) =>
  Array.from({ length: count }, (_, row) =>
    makeRow(list, row, { rating: row % 6, genre: row % 2 === 0 ? 'Rock' : 'Jazz' }),
  );

test('筛选键：勾预设收窄到命中，条件行出预设片；去掉预设退出过滤；查询交给宿主', async ({
  page,
}) => {
  const { host, view, row, errors } = await openPlaylist(page, 'Mix', rated('Mix', 12));
  const subtitle = view.locator('[data-playlist-subtitle]');
  const toggle = view.locator('[data-filter-toggle]');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await page.locator('[data-preset="highRated"]').click();
  // 评分 4、5 的是第 5、6、11、12 首
  await expect(subtitle).toContainText('匹配 4 首');
  await expect(row('Mix 5')).toBeVisible();
  await expect(row('Mix 1')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const conditions = view.locator('[data-query-conditions]');
  await expect(conditions.getByText('高评分')).toBeVisible();
  expect(host.callsTo('playlist.getMatchingRows').at(-1)).toMatchObject({
    query: '%rating% GREATER 3',
  });
  await view.getByRole('button', { name: '移除「高评分」' }).click();
  await expect(subtitle).not.toContainText('匹配');
  await expect(row('Mix 1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('分面：取值来自这张列表，勾选拼成 IS 查询，条件行出分面片；清除条件一并清掉', async ({
  page,
}) => {
  const { host, lists, guid, view, row, errors } = await openPlaylist(
    page,
    'Mix',
    rated('Mix', 12),
  );
  // 宿主按游程给取值：替身里不论问哪一栏都答这一份
  lists.content.setRuns(guid, [
    { start: 0, count: 6, key: 'Rock' },
    { start: 6, count: 6, key: 'Jazz' },
  ]);
  await view.locator('[data-filter-toggle]').click();
  const surface = page.locator('[data-filter-surface]');
  await expect(surface.getByText('流派', { exact: true })).toBeVisible();
  await surface.getByRole('checkbox', { name: /Rock/ }).first().click();
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 6 首');
  await expect(row('Mix 2')).toHaveCount(0);
  await expect(row('Mix 1')).toBeVisible();
  expect(host.callsTo('playlist.getMatchingRows').at(-1)).toMatchObject({
    query: 'genre IS "Rock"',
  });
  await surface.getByRole('button', { name: '清除条件' }).click();
  await expect(view.locator('[data-playlist-subtitle]')).not.toContainText('匹配');
  expect(errors).toEqual([]);
});

test('离开再后退回来：预设也在，过滤后的行还在', async ({ page }) => {
  const { view, row, entry, errors } = await openPlaylist(page, 'Mix', rated('Mix', 12));
  await view.locator('[data-filter-toggle]').click();
  await page.locator('[data-preset="highRated"]').click();
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
  await page.keyboard.press('Escape');
  await entry('Default').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Default', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  const back = page.getByRole('region', { name: 'Mix', exact: true });
  await expect(back.locator('[data-query-conditions]').getByText('高评分')).toBeVisible();
  await expect(back.locator('[data-playlist-subtitle]')).toContainText('匹配 4 首');
  await expect(row('Mix 5')).toBeVisible();
  await expect(row('Mix 1')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('筛选态下表格只列命中、不分组：视图面板里分组置灰，清掉筛选后恢复', async ({ page }) => {
  const { view, errors } = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  const grouping = page.getByRole('combobox', { name: '分组依据' });
  await view.locator('[data-playlist-view]').click();
  await expect(grouping).toBeEnabled();
  await page.keyboard.press('Escape');
  await view.getByRole('searchbox', { name: '在此播放列表中搜索' }).fill('Mix 12');
  await expect(view.locator('[data-playlist-subtitle]')).toContainText('匹配 1 首');
  await view.locator('[data-playlist-view]').click();
  await expect(grouping).toBeDisabled();
  await page.keyboard.press('Escape');
  await view.getByRole('button', { name: '清空输入' }).click();
  await view.locator('[data-playlist-view]').click();
  await expect(grouping).toBeEnabled();
  expect(errors).toEqual([]);
});
