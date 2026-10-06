import { expect, test, type Page } from '@playwright/test';
import { positionOf, type VolumeScale } from '../../src/playback/volumeScale.ts';
import { enterSettings, openSettings } from '../fixtures/settingsPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';

// 「播放」一组：音量刻度。换档只改音量条上的位置怎么换算，不动 foobar2000 的音量。

const VOLUME_SCALE_KEY = 'default-theme.volume-scale.v1';

/** 宿主报的音量，dB；两种刻度下它落在条上的位置不同。 */
const VOLUME_DB = -20;

const stored = (page: Page) =>
  page.evaluate((name) => localStorage.getItem(name), VOLUME_SCALE_KEY);

/** 这个音量在某种刻度下，音量条的 `aria-valuenow`。 */
const positionText = (scale: VolumeScale) => String(Math.round(positionOf(VOLUME_DB, scale)));

test('音量刻度：换到按分贝，音量条即时按新刻度重算并记住，不往宿主发音量；刷新后还在', async ({
  page,
}) => {
  expect(positionText('db')).not.toBe(positionText('perceptual'));
  const settings = await openSettings(page, {
    answers: {
      playback: {
        // 宿主正放着一首：没有当前曲目时底部通栏不出，音量条也就不在。
        getState: { success: true, state: 'playing', canSeek: true, canPause: true },
        getCurrentTrack: { success: true, found: true, track: makeTrack() },
        getVolume: {
          success: true,
          volume: Math.round(100 * 10 ** (VOLUME_DB / 20)),
          volumeDb: VOLUME_DB,
          muted: false,
          isMuted: false,
        },
      },
    },
  });
  const volume = page.locator('[data-player-bar]').getByRole('slider', { name: '音量' });
  await expect(settings.select('音量刻度')).toHaveText('按听感');
  await expect(volume).toHaveAttribute('aria-valuenow', positionText('perceptual'));

  await settings.choose('音量刻度', '按分贝（同 foobar2000）');
  await expect(volume).toHaveAttribute('aria-valuenow', positionText('db'));
  expect(await stored(page)).toBe('db');
  expect(settings.host.callsTo('playback.setVolume')).toEqual([]);

  await page.reload();
  await enterSettings(page);
  await expect(settings.select('音量刻度')).toHaveText('按分贝（同 foobar2000）');
  await expect(volume).toHaveAttribute('aria-valuenow', positionText('db'));

  await settings.choose('音量刻度', '按听感');
  await expect(volume).toHaveAttribute('aria-valuenow', positionText('perceptual'));
  expect(await stored(page)).toBe('perceptual');
  expect(settings.errors).toEqual([]);
});
