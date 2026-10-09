import { expect, test, type Page } from '@playwright/test';
import { BIOGRAPHY_PREFS_KEY } from '../../src/library/biography/biographyPrefs.ts';
import { LASTFM_KEY_PREF } from '../../src/library/biography/lastfm-api/lastfmKey.ts';
import { albumsAnswer } from '../fixtures/albumLibrary.ts';
import { biographyHtml, biographyOverviewHtml } from '../fixtures/biographySamples.ts';
import type { HostParams } from '../fixtures/fakeHost.ts';
import { artistInfoSample } from '../fixtures/lastfmApiSamples.ts';
import { albumRow } from '../fixtures/libraryRows.ts';
import {
  artistSample,
  candidateSample,
  isMusicbrainz,
  releaseGroupsSample,
  searchSample,
} from '../fixtures/musicbrainzSamples.ts';
import { openPlayer, type PlayerPage } from '../fixtures/playerPage.ts';
import { enterSettings } from '../fixtures/settingsPage.ts';
import { makeTrack } from '../fixtures/tracks.ts';
import { expandBiographyArticle } from '../fixtures/biographyActions.ts';

const QUEEN = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3';
const OTHER_QUEEN = '5b0c3d4e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';
const KEY = '0123456789abcdef0123456789abcdef';

const panel = (page: Page) => page.locator('[data-biography]');
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

function json(body: unknown) {
  return {
    success: true as const,
    status: 200,
    headers: {},
    body: JSON.stringify(body),
    responseType: 'text' as const,
  };
}

/** MusicBrainz 上有两位 Queen；`matching` 那位的发行组里有本地那张专辑。 */
function musicbrainz(url: URL, matching: string | null) {
  if (url.pathname === '/ws/2/artist')
    return json(
      searchSample(
        candidateSample(QUEEN, 'Queen', {
          type: 'Group',
          country: 'GB',
          disambiguation: 'UK rock group',
        }),
        candidateSample(OTHER_QUEEN, 'Queen', { country: 'US', disambiguation: 'rapper' }),
      ),
    );
  if (url.pathname === '/ws/2/release-group') {
    const owner = url.searchParams.get('artist');
    return json(releaseGroupsSample(owner === matching ? 'A Night at the Opera' : 'Unrelated'));
  }
  const mbid = url.pathname.split('/').at(-1) ?? '';
  const name = mbid === QUEEN ? 'Queen' : 'Queen (2)';
  return json(
    artistSample(mbid, {
      name: 'Queen',
      type: 'Group',
      'life-span': { begin: '1970', end: null },
      'begin-area': { name: 'London' },
      area: { name: 'United Kingdom' },
      aliases: [],
      relations: [
        {
          type: 'last.fm',
          url: { resource: `https://www.last.fm/music/${encodeURIComponent(name)}` },
        },
      ],
    }),
  );
}

async function start(page: Page, matching: string | null): Promise<PlayerPage> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const player = await openPlayer(page, {
    state: { track: makeTrack({ artist: 'Queen', title: 'Bohemian Rhapsody' }) },
  });
  player.host.answer(
    'library.getAlbums',
    albumsAnswer([albumRow('A Night at the Opera (Deluxe)', 'Queen')]),
  );
  player.host.answer('http.get', (params: HostParams) => {
    const url = new URL(String(params['url']));
    if (isMusicbrainz(url)) return musicbrainz(url, matching);
    if (url.hostname === 'ws.audioscrobbler.com')
      return json(artistInfoSample(url.searchParams.get('artist') ?? '', 'API 给的正文'));
    const name = decodeURIComponent(url.pathname.split('/music/')[1]?.split('/')[0] ?? '');
    const body = url.pathname.endsWith('/+wiki')
      ? biographyHtml(name, `<p>${name} 的正文</p>`, 'en')
      : biographyOverviewHtml(name, 'en');
    return { success: true, status: 200, headers: {}, body, responseType: 'text' };
  });
  player.host.answer('file.write', (params) => ({
    success: true,
    bytesWritten: String(params['content']).length,
  }));
  await page.reload();
  await enterSettings(page);
  await page.locator('[data-settings-nav]').getByRole('button', { name: '在线内容' }).click();
  return player;
}

async function enableOnline(page: Page) {
  const toggle = page.getByRole('switch', { name: '在线艺人简介' });
  await expect(toggle).toBeEnabled();
  await toggle.check();
}

async function openBiography(page: Page) {
  await page.locator('[data-right-card-key="queue"]').click();
  await tab(page, '简介').click();
  await expect(panel(page)).toBeVisible();
}

function musicbrainzUrls(player: PlayerPage): readonly string[] {
  return player.host
    .callsTo('http.get')
    .map((call) => String(call['url']))
    .filter((url) => isMusicbrainz(url));
}

test('本地专辑对上一位就自动认定，不用手动确认；资料来自 MusicBrainz，专辑名不外发', async ({
  page,
}) => {
  const player = await start(page, QUEEN);
  await enableOnline(page);
  await openBiography(page);
  await expect(panel(page).getByText('Queen 的正文')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: '确认艺人', exact: true })).toHaveCount(0);
  await expandBiographyArticle(page);
  await expect(panel(page).getByText('成立', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('1970 · London')).toBeVisible();
  const urls = musicbrainzUrls(player);
  expect(urls.some((url) => url.includes(`/ws/2/artist/${QUEEN}`))).toBe(true);
  expect(urls.join(' ')).not.toMatch(/Opera/i);
  expect(await player.host.config.get(BIOGRAPHY_PREFS_KEY)).toMatchObject({ identities: [] });
});

test('同名的都对不上时列出候选，选中一位后取他的正文并记成手选；重新确认时再列候选', async ({
  page,
}) => {
  const player = await start(page, null);
  await enableOnline(page);
  await openBiography(page);
  const list = panel(page).getByRole('region', { name: '同名艺人' });
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByText('rapper · US')).toBeVisible();
  await list.getByRole('button', { name: /rapper/ }).click();
  await expect(panel(page).getByText('Queen (2) 的正文')).toBeVisible();
  await expect
    .poll(() => player.host.config.get(BIOGRAPHY_PREFS_KEY))
    .toMatchObject({
      identities: [{ artist: 'Queen', sourceArtist: 'Queen (2)', mbid: OTHER_QUEEN }],
    });
  await panel(page).getByRole('button', { name: '重新确认艺人' }).click();
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(panel(page).getByText('Queen (2) 的正文')).toHaveCount(0);
});

test('Last.fm key：在线关着时不能填，格式不对就地提示；填对后校验，正文改走 API', async ({
  page,
}) => {
  const player = await start(page, QUEEN);
  const input = page.getByLabel('Last.fm API 密钥');
  await page.getByRole('button', { name: '在线艺人简介', exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(page.getByText('在线内容未开启')).toBeVisible();
  await enableOnline(page);
  await input.fill('abc');
  await input.press('Enter');
  await expect(
    page
      .locator('[data-settings-row]')
      .getByRole('status')
      .filter({ hasText: '密钥须包含 32 个十六进制字符' }),
  ).toHaveCount(1);
  await input.fill(KEY.toUpperCase());
  await input.press('Enter');
  await expect(page.getByText('可用', { exact: true })).toBeVisible();
  await expect.poll(() => player.host.config.get(LASTFM_KEY_PREF.key)).toBe(KEY);
  await expect(input).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '显示密钥' }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await openBiography(page);
  await expect(panel(page).getByText('API 给的正文')).toBeVisible();
  await expandBiographyArticle(page);
  await expect(panel(page).getByText('Last.fm 听众', { exact: true })).toBeVisible();
  const urls = player.host.callsTo('http.get').map((call) => String(call['url']));
  expect(urls.some((url) => url.endsWith('/+wiki'))).toBe(false);
  expect(urls.filter((url) => url.startsWith('https://ws.audioscrobbler.com/'))).toHaveLength(2);
});
