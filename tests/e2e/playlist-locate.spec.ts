import { expect, test } from '@playwright/test';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { albumTracks, openPlaylist, type PlaylistPage } from '../fixtures/playlistPage.ts';

// 播放列表页从外面来的定位：F2 定位正在播放（折起的组先展开、过滤挡住先清过滤，不改选中、不起播），
// 打字即跳（找到第一页之外的行，只选它）。

/** 宿主开始放这张列表的第 `row` 行：替身记下位置，再推一条换曲事件，页面据此认得正在播放的那一首。 */
async function playRow(view: PlaylistPage, row: number): Promise<void> {
  const list = view.lists.items.find((item) => item.guid === view.guid);
  const track = list ? view.lists.tracksOf(list)[row] : undefined;
  if (!list || !track) throw new Error(`没有第 ${row} 行`);
  view.lists.content.played(list, row);
  await view.host.waitForListener('playback:trackChanged');
  await view.host.emit('playback:trackChanged', track);
  await view.host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 1,
    duration: track.duration,
    canSeek: true,
  });
}

test('F2：正在播放的那一行在折起的组里，先展开再把焦点落上去，选中与播放都不动', async ({
  page,
}) => {
  const view = await openPlaylist(page, 'Mix', albumTracks('Mix', 3, 4));
  const { host, lists, guid, row, group, errors } = view;
  await playRow(view, 9);
  await group('Album 3 | Artist 3').click();
  await expect(row('Mix 10')).toHaveCount(0);
  await row('Mix 2').click();
  await expect.poll(() => lists.content.selection(guid)).toEqual([1]);

  await page.keyboard.press('F2');
  await expect(row('Mix 10')).toHaveAttribute('data-row-focus', 'true');
  await expect(row('Mix 10')).toBeInViewport();
  expect(lists.content.selection(guid)).toEqual([1]);
  expect(host.callsTo('playlist.playTrack')).toEqual([]);
  expect(errors).toEqual([]);
});

test('F2：正在播放的那一行被过滤挡住，先清过滤再落上去', async ({ page }) => {
  const view = await openPlaylist(page, 'Mix');
  const { row, errors } = view;
  await playRow(view, 5);
  const filter = view.view.getByRole('textbox', { name: '筛选此播放列表' });
  await filter.fill('Mix 1');
  await expect(view.view.locator('[data-playlist-subtitle]')).toContainText('匹配');
  await row('Mix 10').click();
  await page.keyboard.press('F2');
  await expect(row('Mix 6')).toHaveAttribute('data-row-focus', 'true');
  await expect(filter).toHaveValue('');
  expect(errors).toEqual([]);
});

test('打字即跳：按专辑艺术家找到第一页之外的那一首，只选它，右下角提示打过的字', async ({
  page,
}) => {
  const tracks = Array.from({ length: 300 }, (_, at) =>
    makeRow('Mix', at, { albumArtist: at === 250 ? 'Zeta' : 'Nujabes' }),
  );
  const view = await openPlaylist(page, 'Mix', tracks);
  const { row, guid, errors } = view;
  await row('Mix 2').click();
  await page.keyboard.type('zeta');
  await expect(view.view.getByRole('status').filter({ hasText: 'zeta' })).toBeVisible();
  await expect(row('Mix 251')).toHaveAttribute('data-row-focus', 'true');
  await expect(row('Mix 251')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => view.lists.content.selection(guid)).toEqual([250]);
  expect(errors).toEqual([]);
});
