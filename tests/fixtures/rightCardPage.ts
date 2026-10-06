import { expect, type Page } from '@playwright/test';
import { openPlayer } from './playerPage.ts';
import { makeTrack } from './tracks.ts';

export const QUEUE_LIST_GUID = '{11111111-1111-1111-1111-111111111111}';

/** 大列表只按被读页生成曲目，避免替身自己先为几十万首分配对象。`name` 是在播那张表的名字。 */
export async function openLargeQueue(
  page: Page,
  total = 120000,
  delayMs = 0,
  name = '完整播放来源',
) {
  const player = await openPlayer(page);
  const { host } = player;
  host.answer('playlist.getAll', {
    success: true,
    count: 1,
    playlists: [
      {
        guid: QUEUE_LIST_GUID,
        index: 0,
        name,
        trackCount: total + 1,
        isActive: true,
        isPlaying: true,
        isLocked: false,
        isAutoplaylist: false,
      },
    ],
  });
  host.answer('playback.getCurrentTrackIndex', {
    success: true,
    found: true,
    playlist: 0,
    playlistGuid: QUEUE_LIST_GUID,
    index: 0,
  });
  host.answer('config.getPlaybackFollowCursor', { success: true, enabled: false, value: false });
  host.answer(
    'playlist.getTracks',
    (params) => {
      const start = Number(params['start']);
      const count = Math.min(Number(params['count']), total + 1 - start);
      return {
        success: true,
        playlist: 0,
        start,
        count,
        total: total + 1,
        tracks: Array.from({ length: count }, (_, i) => ({
          ...makeTrack({
            path: `file://E:/Music/queue/${start + i}.flac`,
            title: `曲目 ${start + i}`,
            artist: '很长的艺人姓名以及合作艺人',
            album: '很长的专辑名称与附加说明',
            duration: 4567,
          }),
          index: start + i,
        })),
      };
    },
    { delayMs },
  );
  await host.waitForListener('playback:trackChanged');
  await host.waitForListener('playback:followCursorChanged');
  await host.emit('playback:followCursorChanged', { enabled: false });
  player.state.track = makeTrack({ path: 'file://E:/Music/queue/0.flac', title: '曲目 0' });
  await host.emit('playback:trackChanged', player.state.track);
  await page.locator('[data-right-card-key="queue"]').click();
  await expect(
    page.locator('[data-queue-row]').filter({ hasText: '曲目 1' }).first(),
  ).toBeVisible();
  return player;
}

export const queueScroller = (page: Page) => page.locator('[data-queue-page]').locator('..');
