// @vitest-environment jsdom
import { fb } from 'foo-webview-sdk/bridge';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startAlbumArtistPhoto } from '../../../../src/library/album-detail/albumArtistPhoto.ts';
import type { AlbumsState } from '../../../../src/library/albums.ts';
import {
  BIOGRAPHY_PREFS_KEY,
  startBiographyPrefs,
} from '../../../../src/library/biography/biographyPrefs.ts';
import { startBiographyResources } from '../../../../src/library/biography/biographyResources.ts';
import { startBiographySourcePrefs } from '../../../../src/library/biography/biographySourcePrefs.ts';
import { startLastfmKey } from '../../../../src/library/biography/lastfm-api/lastfmKey.ts';
import type { BiographyLanguage } from '../../../../src/library/biography/biographyModel.ts';
import { lookupAnswer, searchAnswer } from '../../../fixtures/appleCatalog.ts';
import { applePageHtml } from '../../../fixtures/applePages.ts';
import { installArtistFiles } from '../../../fixtures/artistFilesHost.ts';
import { selectLastfmSource } from '../../../fixtures/biographySource.ts';
import { biographyPhotoHtml } from '../../../fixtures/biographyPhotoSamples.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

const QUEEN = { id: 3296287, name: 'Queen' };
const PIXELS = async () => new Uint8ClampedArray([1, 2, 3, 255]);
// 1×1 的 PNG：图片请求都答它
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface SetupOptions {
  /** 简介里选 Last.fm 作来源；缺省是 Apple Music */
  readonly lastfm?: boolean;
}

function setup(options: SetupOptions = {}) {
  const { host } = installArtistFiles();
  host.config.set(BIOGRAPHY_PREFS_KEY, {
    version: 1,
    enabled: true,
    language: 'auto',
    // Last.fm 的身份靠 MusicBrainz 认定，测试里直接指定，不去模拟它
    identities: options.lastfm ? [{ artist: 'Queen', sourceArtist: 'Queen' }] : [],
  });
  if (options.lastfm) selectLastfmSource(host);
  const store = createStore();
  const resources = startBiographyResources(store, host.fb);
  const prefs = startBiographyPrefs(store, host.fb);
  const sourcePrefs = startBiographySourcePrefs(store, host.fb);
  const lastfmKey = startLastfmKey(store, host.fb);
  const library: AlbumsState = {
    status: 'ready',
    enabled: true,
    albums: [albumRow('Greatest Hits', 'Queen', { year: '1981', trackCount: 17 })],
    total: 1,
    truncated: false,
  };
  const service = startAlbumArtistPhoto(store, {
    prefs,
    sourcePrefs,
    resources,
    lastfmKey,
    language: atom<BiographyLanguage>('en'),
    locale: atom('en'),
    probe: PIXELS,
    motionEnabled: atom(false),
    albums: atom(library),
  });
  onTestFinished(() => {
    service.dispose();
    lastfmKey.dispose();
    sourcePrefs.dispose();
    prefs.dispose();
    resources.dispose();
  });
  return { host, store, service };
}

const text = (body: string) => ({
  success: true as const,
  status: 200,
  headers: {},
  body,
  responseType: 'text' as const,
});
const image = () => ({
  success: true as const,
  status: 200,
  headers: { 'Content-Type': 'image/png' },
  body: PNG,
  responseType: 'base64' as const,
});

/** 宿主替身里的 Apple：搜索答 Queen，Lookup 答一张专辑，艺人页答样本页，图片答同一张 */
function apple(host: ReturnType<typeof setup>['host']) {
  host.answer('http.get', (params) => {
    const url = new URL(String(params['url']));
    if (url.hostname === 'itunes.apple.com' && url.pathname === '/search')
      return text(JSON.stringify(searchAnswer(QUEEN)));
    if (url.hostname === 'itunes.apple.com')
      return text(
        JSON.stringify(
          lookupAnswer({
            1: { artist: QUEEN, albums: [{ title: 'Greatest Hits', year: 1981, tracks: 17 }] },
          }),
        ),
      );
    if (url.hostname === 'music.apple.com') return text(applePageHtml());
    return image();
  });
}

/** 宿主替身里的 Last.fm：站内页面答带照片的样本，图片答同一张；记下问过的主机名 */
function lastfm(host: ReturnType<typeof setup>['host']) {
  host.answer('http.get', (params) => {
    const url = new URL(String(params['url']));
    if (url.hostname.endsWith('last.fm')) return text(biographyPhotoHtml('Queen', true));
    return image();
  });
}

const hostsAsked = (host: ReturnType<typeof setup>['host']) =>
  host.callsTo('http.get').map((call) => new URL(String(call['url'])).hostname);

describe('专辑详情页头的艺人头像', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    // 简介服务拿全局的 `fb` 等宿主；替身装好后让它也算就绪
    vi.spyOn(fb, 'isAvailable').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('来源是 Apple Music：登记专辑艺人后认定并取到艺术照，不为头像拉宽幅头图', async () => {
    const { host, store, service } = setup();
    apple(host);
    await vi.advanceTimersByTimeAsync(100);
    expect(store.get(service.photo)).toBeNull();
    service.show('Queen');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.get(service.photo)).toEqual(expect.any(String));
    expect(host.callsTo('http.get').some((call) => String(call['url']).includes('1280x720'))).toBe(
      false,
    );
  });

  it('来源是 Last.fm：照 Last.fm 取图，不去问 Apple', async () => {
    const { host, store, service } = setup({ lastfm: true });
    lastfm(host);
    await vi.advanceTimersByTimeAsync(100);
    service.show('Queen');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.get(service.photo)).toEqual(expect.any(String));
    expect(hostsAsked(host).some((name) => name.endsWith('apple.com'))).toBe(false);
    expect(hostsAsked(host).some((name) => name.endsWith('last.fm'))).toBe(true);
  });

  it('Last.fm 来源只取头像这一张：不取相册页，也不把相册里的图一张张下载', async () => {
    const { host, store, service } = setup({ lastfm: true });
    lastfm(host);
    await vi.advanceTimersByTimeAsync(100);
    service.show('Queen');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.get(service.photo)).toEqual(expect.any(String));
    const asked = host.callsTo('http.get').map((call) => new URL(String(call['url'])));
    expect(asked.some((url) => url.pathname.endsWith('/+images'))).toBe(false);
    expect(asked.filter((url) => url.hostname.includes('lastfm-img'))).toHaveLength(1);
  });

  it('合辑类的名字不联网，也没有照片', async () => {
    const { host, store, service } = setup();
    apple(host);
    await vi.advanceTimersByTimeAsync(100);
    service.show('Various Artists');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.get(service.subject)).toBeNull();
    expect(store.get(service.photo)).toBeNull();
    expect(host.callsTo('http.get')).toHaveLength(0);
  });

  it('释放登记后头像清掉；先登记的页面卸载时不清后登记的那一位', async () => {
    const { host, store, service } = setup();
    apple(host);
    await vi.advanceTimersByTimeAsync(100);
    const leaveFirst = service.show('Queen');
    const leaveSecond = service.show('Queen');
    leaveFirst();
    expect(store.get(service.subject)).toBe('Queen');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.get(service.photo)).not.toBeNull();
    leaveSecond();
    expect(store.get(service.subject)).toBeNull();
    expect(store.get(service.photo)).toBeNull();
  });
});
