import { fb } from 'foo-webview-sdk/bridge';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { LocalAlbum } from '../../../../src/library/biography/apple/appleMatch.ts';
import {
  BIOGRAPHY_PREFS_KEY,
  startBiographyPrefs,
} from '../../../../src/library/biography/biographyPrefs.ts';
import { startBiographyResources } from '../../../../src/library/biography/biographyResources.ts';
import { startBiographySourcePrefs } from '../../../../src/library/biography/biographySourcePrefs.ts';
import { startLastfmKey } from '../../../../src/library/biography/lastfm-api/lastfmKey.ts';
import type { BiographyLanguage } from '../../../../src/library/biography/biographyModel.ts';
import {
  onlineArtistKey,
  startOnlineArtistBiography,
} from '../../../../src/library/online/onlineArtistBiography.ts';
import type { MusicRef } from '../../../../src/server/musicObjects.ts';
import { lookupAnswer, searchAnswer } from '../../../fixtures/appleCatalog.ts';
import { applePageHtml } from '../../../fixtures/applePages.ts';
import { installArtistFiles } from '../../../fixtures/artistFilesHost.ts';

const FIRST: MusicRef = { platform: 'wy', id: '100' };
const SECOND: MusicRef = { platform: 'wy', id: '200' };

interface SetupOptions {
  /** 在线内容开关；缺省关着 */
  readonly enabled?: boolean;
  readonly probe?: (url: string) => Promise<Uint8ClampedArray | null>;
}

function setup(options: SetupOptions = {}) {
  const { host } = installArtistFiles();
  if (options.enabled)
    host.config.set(BIOGRAPHY_PREFS_KEY, {
      version: 1,
      enabled: true,
      language: 'auto',
      identities: [],
    });
  const store = createStore();
  const resources = startBiographyResources(store, host.fb);
  const prefs = startBiographyPrefs(store, host.fb);
  const sourcePrefs = startBiographySourcePrefs(store, host.fb);
  const lastfmKey = startLastfmKey(store, host.fb);
  const service = startOnlineArtistBiography(store, {
    prefs,
    sourcePrefs,
    resources,
    lastfmKey,
    language: atom<BiographyLanguage>('en'),
    locale: atom('en'),
    probe: options.probe ?? (async () => null),
    motionEnabled: atom(false),
    viewerTop: atom(48),
    openSettings() {},
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

describe('在线艺人页的简介登记', () => {
  it('身份的键带着平台与艺人 ID，同名的两位艺人键不同；名字只用来显示与搜索', () => {
    expect(onlineArtistKey(FIRST)).toBe('online:wy:100');
    expect(onlineArtistKey(FIRST)).not.toBe(onlineArtistKey(SECOND));
    const { store, service } = setup();
    service.show(FIRST, 'Lorn');
    expect(store.get(service.subject)).toBe('online:wy:100');
    expect(store.get(service.current)).toEqual({ ref: FIRST, name: 'Lorn' });
  });

  it('合辑类的名字不联网：没有身份键', () => {
    const { store, service } = setup();
    service.show(FIRST, 'Various Artists');
    expect(store.get(service.subject)).toBeNull();
  });

  it('转场时先登记的页面卸载，不会清掉后登记的那一位；只有自己是最后登记的才清', () => {
    const { store, service } = setup();
    const leaveFirst = service.show(FIRST, 'Lorn');
    const leaveSecond = service.show(SECOND, 'Lorn');
    leaveFirst();
    expect(store.get(service.current)).toEqual({ ref: SECOND, name: 'Lorn' });
    leaveSecond();
    expect(store.get(service.current)).toBeNull();
  });
});

describe('「照片」键占位与头部图的信号', () => {
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

  const QUEEN = { id: 3296287, name: 'Queen' };
  const OWNED: readonly LocalAlbum[] = [{ name: 'Greatest Hits', year: 1981, trackCount: 17 }];
  const PIXELS = async () => new Uint8ClampedArray([1, 2, 3, 255]);
  // 1×1 的 PNG：图片请求都答它
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /** 宿主替身里的 Apple：搜索按 `found` 答，Lookup 答一张专辑，艺人页答样本页，图片答同一张 */
  function apple(host: ReturnType<typeof setup>['host'], found: boolean) {
    const text = (body: string) => ({
      success: true as const,
      status: 200,
      headers: {},
      body,
      responseType: 'text' as const,
    });
    host.answer('http.get', (params) => {
      const url = new URL(String(params['url']));
      if (url.hostname === 'itunes.apple.com' && url.pathname === '/search')
        return text(JSON.stringify(searchAnswer(...(found ? [QUEEN] : []))));
      if (url.hostname === 'itunes.apple.com')
        return text(
          JSON.stringify(
            lookupAnswer({
              1: { artist: QUEEN, albums: [{ title: 'Greatest Hits', year: 1981, tracks: 17 }] },
            }),
          ),
        );
      if (url.hostname === 'music.apple.com') return text(applePageHtml());
      return {
        success: true as const,
        status: 200,
        headers: { 'Content-Type': 'image/png' },
        body: PNG,
        responseType: 'base64' as const,
      };
    });
  }

  /** 每个同步段落结束时的取值，连续相同的只记一次；同一个同步段落里的中间值不算 */
  function settled(env: ReturnType<typeof setup>) {
    const seen: boolean[] = [];
    const note = () =>
      void Promise.resolve().then(() => {
        const value = env.store.get(env.service.searching);
        if (seen.at(-1) !== value) seen.push(value);
      });
    note();
    env.store.sub(env.service.searching, note);
    return seen;
  }

  it('从进页到认定、取正文、取照片都做完才结束，中途不会空一下：占位转到图出来为止', async () => {
    const env = setup({ enabled: true, probe: PIXELS });
    apple(env.host, true);
    await vi.advanceTimersByTimeAsync(100);
    env.service.show(FIRST, 'Queen');
    env.service.setAlbums(FIRST, OWNED);
    const seen = settled(env);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual([true, false]);
    expect(env.store.get(env.service.onlinePhoto.state).photo).not.toBeNull();
  });

  it('艺术照已经到了、宽幅图还在取：仍算在拉，等宽幅图也到了才结束', async () => {
    const env = setup({ enabled: true, probe: PIXELS });
    apple(env.host, true);
    const held = env.host.hold('http.get');
    await vi.advanceTimersByTimeAsync(100);
    env.service.show(FIRST, 'Queen');
    env.service.setAlbums(FIRST, OWNED);
    // 宽幅图的静帧取 1280×720，艺术照取 600×600；先放行别的请求，扣住宽幅图
    const isHero = (params: Record<string, unknown>) => String(params['url']).includes('1280x720');
    for (let step = 0; step < 12 && !held.pending.some(isHero); step += 1) {
      await vi.advanceTimersByTimeAsync(3500);
      for (let index = held.pending.length - 1; index >= 0; index -= 1) {
        const params = held.pending[index];
        if (params && !isHero(params)) held.respond(index);
      }
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(env.store.get(env.service.onlinePhoto.state).photo).not.toBeNull();
    expect(env.store.get(env.service.hero.state).photo).toBeNull();
    expect(env.store.get(env.service.searching)).toBe(true);
    held.respond(held.pending.findIndex(isHero));
    await vi.advanceTimersByTimeAsync(100);
    expect(env.store.get(env.service.hero.state).photo).not.toBeNull();
    expect(env.store.get(env.service.searching)).toBe(false);
  });

  it('取到过宽幅图的艺人记在名单里，离开后还在，页面第一次渲染就能查；没取到过的不在', async () => {
    const env = setup({ enabled: true, probe: PIXELS });
    apple(env.host, true);
    await vi.advanceTimersByTimeAsync(100);
    const leave = env.service.show(FIRST, 'Queen');
    env.service.setAlbums(FIRST, OWNED);
    expect(env.store.get(env.service.heroSeen).has(onlineArtistKey(FIRST))).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.store.get(env.service.heroSeen).has(onlineArtistKey(FIRST))).toBe(true);
    leave();
    // 艺人没登记（页面刚渲染、还没跑 effect）时名单照样给
    expect(env.store.get(env.service.heroSeen).has(onlineArtistKey(FIRST))).toBe(true);
    expect(env.store.get(env.service.heroSeen).has(onlineArtistKey(SECOND))).toBe(false);
  });

  it('在线内容关着时名单为空：不会为一个不会来的宽幅图空等', async () => {
    const env = setup({ enabled: true, probe: PIXELS });
    apple(env.host, true);
    await vi.advanceTimersByTimeAsync(100);
    env.service.show(FIRST, 'Queen');
    env.service.setAlbums(FIRST, OWNED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.store.get(env.service.heroSeen).size).toBe(1);
    env.service.prefs.setEnabled(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(env.store.get(env.service.heroSeen).size).toBe(0);
  });

  it('Apple 上没有这位、取不到简介里的照片：找完就结束，不一直转', async () => {
    const none = setup({ enabled: true });
    apple(none.host, false);
    await vi.advanceTimersByTimeAsync(100);
    none.service.show(FIRST, 'Queen');
    none.service.setAlbums(FIRST, OWNED);
    const seenNone = settled(none);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seenNone).toEqual([true, false]);
    expect(none.store.get(none.service.onlinePhoto.state).photo).toBeNull();

    // 照片解码失败（probe 读不出）：有问题记录，同样结束
    const broken = setup({ enabled: true });
    apple(broken.host, true);
    await vi.advanceTimersByTimeAsync(100);
    broken.service.show(FIRST, 'Queen');
    broken.service.setAlbums(FIRST, OWNED);
    const seenBroken = settled(broken);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seenBroken).toEqual([true, false]);
  });

  it('在线内容关着、没有登记艺人、合辑类名字都不算在找', async () => {
    const off = setup();
    apple(off.host, true);
    await vi.advanceTimersByTimeAsync(100);
    off.service.show(FIRST, 'Queen');
    off.service.setAlbums(FIRST, OWNED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(off.store.get(off.service.searching)).toBe(false);

    const idle = setup({ enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(idle.store.get(idle.service.searching)).toBe(false);
    idle.service.show(FIRST, 'Various Artists');
    expect(idle.store.get(idle.service.searching)).toBe(false);
  });
});
