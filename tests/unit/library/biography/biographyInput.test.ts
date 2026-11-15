import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AppleManualIdentity } from '../../../../src/library/biography/apple/appleIdentityRecord.ts';
import {
  localAlbumsOf,
  startBiographyInput,
} from '../../../../src/library/biography/biographyInput.ts';
import type {
  BiographyIdentity,
  BiographyLanguage,
  BiographySource,
} from '../../../../src/library/biography/biographyModel.ts';
import { startBiographyResources } from '../../../../src/library/biography/biographyResources.ts';
import type { AlbumsState } from '../../../../src/library/albums.ts';
import { lookupAnswer, searchAnswer } from '../../../fixtures/appleCatalog.ts';
import { installArtistFiles } from '../../../fixtures/artistFilesHost.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(1500);

const NIRVANA = { id: 112018, name: 'Nirvana', genre: '另类音乐' };
const RIVAL = { id: 256176428, name: 'Nirvana' };
const URL_1 = 'https://music.apple.com/cn/artist/nirvana/112018';

function album(name: string, year: string, trackCount: number, albumArtist = 'Nirvana') {
  return {
    name,
    artist: albumArtist,
    albumArtist,
    trackCount,
    discCount: 1,
    duration: 100,
    year,
    genre: '',
    label: '',
    firstTrackPath: '',
  };
}

const READY: AlbumsState = {
  status: 'ready',
  enabled: true,
  albums: [album('Nevermind', '1991-09-24', 13), album('Guest', '2000', 3, 'Someone Else')],
  total: 2,
  truncated: false,
};

interface SetupOptions {
  /** 为真时 Apple 上有两位同名的 Nirvana，只有年份和曲数能分出本地这一位 */
  readonly rival?: boolean;
  readonly albums?: AlbumsState['albums'];
}

function setup(
  source: BiographySource = 'apple',
  language: BiographyLanguage = 'zh',
  options: SetupOptions = {},
) {
  const { rival = false, albums = READY.albums } = options;
  const env = installArtistFiles();
  const urls: string[] = [];
  env.host.answer('http.get', (params) => {
    const url = String(params['url']);
    urls.push(url);
    const catalog = {
      1: { artist: NIRVANA, albums: [{ title: 'Nevermind', year: 1991, tracks: 13 }] },
      2: { artist: RIVAL, albums: [{ title: 'Black Flower', year: 2015, tracks: 10 }] },
    };
    const body = url.includes('/search?')
      ? searchAnswer(...(rival ? [RIVAL, NIRVANA] : [NIRVANA]))
      : url.includes('/lookup?')
        ? lookupAnswer(rival ? catalog : { 1: catalog[1] })
        : { artists: [] };
    return {
      success: true as const,
      status: 200,
      headers: {},
      body: JSON.stringify(body),
      responseType: 'text' as const,
    };
  });
  const store = createStore();
  const resources = startBiographyResources(store, env.host.fb);
  const sourceAtom = atom<BiographySource>(source);
  const lastfmManual = atom<BiographyIdentity | null>(null);
  const appleManual = atom<AppleManualIdentity | null>(null);
  const languageAtom = atom<BiographyLanguage>(language);
  const wiring = startBiographyInput(store, {
    artist: atom<string | null>('Nirvana'),
    albums: atom(localAlbumsOf({ ...READY, albums }, 'Nirvana')),
    source: sourceAtom,
    language: languageAtom,
    locale: atom('en'),
    enabled: atom(true),
    active: atom(true),
    lastfmManual,
    appleManual,
    resources,
  });
  onTestFinished(() => {
    wiring.dispose();
    resources.dispose();
  });
  return {
    store,
    wiring,
    urls,
    sourceAtom,
    lastfmManual,
    appleManual,
    languageAtom,
    input: () => store.get(wiring.input),
    hosts: () => [...new Set(urls.map((url) => new URL(url).hostname))],
  };
}

describe('简介输入的接线', () => {
  it('Apple 来源：只有 Apple 的身份服务发请求，认定后输入带艺人 ID 与页面地址', async () => {
    const env = setup('apple');
    await tick();
    // 艺人页是认定时提前取的（名字唯一一致），不是简介服务取的
    expect(env.hosts()).toEqual(['itunes.apple.com', 'music.apple.com']);
    expect(env.input()).toEqual({
      artist: 'Nirvana',
      source: 'apple',
      sourceId: '112018',
      sourceArtist: 'Nirvana',
      sourceUrl: URL_1,
      language: 'zh',
    });
  });

  it('名字唯一一致时认定期间就提前取艺人页，地址与取简介时的第一个请求一致：zh 取原址，其余语言先取 en-GB', async () => {
    const pageUrls = (env: ReturnType<typeof setup>) =>
      env.urls.filter((url) => url.includes('music.apple.com'));
    const zh = setup('apple', 'zh');
    await tick();
    expect(pageUrls(zh)).toEqual([URL_1]);
    const en = setup('apple', 'ja');
    await tick();
    expect(pageUrls(en)).toEqual([`${URL_1}?l=en-GB`]);
  });

  it('同名的不止一位时不猜：要等专辑比对才知道是哪位，认定前不取艺人页', async () => {
    const env = setup('apple', 'zh', { rival: true });
    await tick();
    expect(env.hosts()).toEqual(['itunes.apple.com']);
  });

  it('本地专辑带着发行年份和曲数去比对：两位同名者里专辑标题、年份、曲数都对得上的那位认定，哪怕搜索结果里另一位排在前面', async () => {
    const env = setup('apple', 'zh', { rival: true });
    await tick();
    expect(env.input()).toMatchObject({ sourceId: '112018' });
    // 请求里只有艺人名与 ID，不外发本地专辑名
    expect(JSON.stringify(env.urls)).not.toContain('Nevermind');
  });

  it('本地专辑读不出年份、曲数又太少时，只有标题对上的弱证据也认有重合的那位，不让用户选', async () => {
    const env = setup('apple', 'zh', { rival: true, albums: [album('Nevermind', '', 2)] });
    await tick();
    expect(env.input()).toMatchObject({ sourceId: '112018', sourceArtist: 'Nirvana' });
  });

  it('Last.fm 来源：只有 Last.fm 一路的 MusicBrainz 发请求，没认定时输入里没有身份', async () => {
    const env = setup('lastfm');
    await tick();
    expect(env.hosts()).toEqual(['musicbrainz.org']);
    expect(env.input()).toEqual({
      artist: 'Nirvana',
      source: 'lastfm',
      sourceId: null,
      sourceArtist: null,
      language: 'zh',
    });
  });

  it('Apple 只有中文和英文两种页面：其余界面语言一律取英文', async () => {
    const env = setup('apple', 'ja');
    await tick();
    expect(env.input()?.language).toBe('en');
    env.store.set(env.languageAtom, 'zh');
    expect(env.input()?.language).toBe('zh');
    env.store.set(env.languageAtom, 'fr');
    expect(env.input()?.language).toBe('en');
  });

  it('手选优先：选了某一位直接用；「这些都不是」不显示简介，也不用自动认定的那位顶替', async () => {
    const env = setup('apple');
    await tick();
    env.store.set(env.appleManual, {
      artist: 'Nirvana',
      sourceId: '256176428',
      sourceArtist: 'Nirvana',
      url: 'https://music.apple.com/cn/artist/nirvana/256176428',
    });
    expect(env.input()).toMatchObject({ sourceId: '256176428' });
    env.store.set(env.appleManual, { artist: 'Nirvana', declined: true });
    expect(env.input()).toMatchObject({ sourceId: null, sourceArtist: null });
    expect(env.input()).not.toHaveProperty('sourceUrl');
  });

  it('Last.fm 的手选直接用', async () => {
    const env = setup('lastfm');
    env.store.set(env.lastfmManual, { artist: 'Nirvana', sourceArtist: 'Nirvana (US)' });
    expect(env.input()).toMatchObject({
      source: 'lastfm',
      sourceId: 'Nirvana (US)',
      sourceArtist: 'Nirvana (US)',
    });
  });

  it('换来源后输入跟着换，另一个来源的身份服务才开始请求', async () => {
    const env = setup('lastfm');
    await tick();
    expect(env.hosts()).toEqual(['musicbrainz.org']);
    env.store.set(env.sourceAtom, 'apple');
    await tick();
    expect(env.hosts().sort()).toEqual(['itunes.apple.com', 'music.apple.com', 'musicbrainz.org']);
    expect(env.input()).toMatchObject({ source: 'apple', sourceId: '112018' });
  });
});
