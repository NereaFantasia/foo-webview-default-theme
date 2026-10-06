import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ArtistDetailState } from '../../../../src/library/artists/artistDetail.ts';
import { startArtistOnline } from '../../../../src/library/artists/artistOnline.ts';
import type { fetchLastfmTops } from '../../../../src/library/biography/lastfm-api/lastfmArtistTops.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';
import { ARTIST_ALBUMS } from '../../../fixtures/artistsLibrary.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);

type Fetch = typeof fetchLastfmTops;

const TOPS: Awaited<ReturnType<Fetch>> = {
  ok: true,
  tracks: [
    {
      rank: 1,
      title: 'Feather (feat. Cise Starr)',
      plays: 9,
      listeners: 1,
      url: 'https://www.last.fm/a',
    },
  ],
  albums: [
    { title: 'Modal Soul', plays: 9, url: 'https://www.last.fm/b' },
    { title: 'Spiritual State', plays: 5, url: 'https://www.last.fm/c' },
  ],
  similar: [{ artist: 'Uyama Hiroto', match: 1, url: 'https://www.last.fm/music/Uyama+Hiroto' }],
  expiresAt: Date.now() + 60_000,
};

function setup() {
  const host = installFakeHost();
  const store = createStore();
  const album = ARTIST_ALBUMS[0];
  const detail: ArtistDetailState = {
    status: 'ready',
    subject: 'Nujabes',
    partial: false,
    refreshFailed: false,
    stamp: 0,
    guestPending: false,
    plays: { status: 'idle' },
    detail: album
      ? {
          subject: 'Nujabes',
          own: [{ album, tracks: [trackRow('Modal Soul', 'Feather')] }],
          guest: [],
          summary: {
            ownAlbums: 1,
            guestAlbums: 0,
            tracks: 1,
            duration: 1,
            firstYear: '',
            lastYear: '',
          },
          collaborators: [],
        }
      : null,
  };
  const deps = {
    sourceArtist: atom<string | null>('Nujabes'),
    apiKey: atom('k'),
    enabled: atom(true),
    active: atom(true),
    detail: atom(detail),
    libraryArtists: atom<readonly string[]>(['Uyama Hiroto']),
  };
  const fetch = vi.fn<Fetch>(async () => TOPS);
  const service = startArtistOnline(store, deps, host.fb, fetch);
  onTestFinished(() => service.dispose());
  return { ...deps, store, fetch, service, state: () => store.get(service.state) };
}

describe('艺人页在线补充', () => {
  it('无效 key 改正后解除旧凭据的退避，并发布新 key 取回的热门', async () => {
    const env = setup();
    env.fetch.mockResolvedValueOnce({
      ok: false,
      problem: 'keyInvalid',
      retryAt: Date.now() + 900_000,
    });
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', problem: 'keyInvalid' });
    env.store.set(env.apiKey, 'corrected');
    await tick();
    expect(env.state()).toMatchObject({ status: 'ready', problem: null });
    expect(env.state().tracks[0]?.local?.title).toBe('Feather');
    expect(env.fetch).toHaveBeenLastCalledWith('Nujabes', 'corrected', expect.anything());
  });

  it('更换 key 不绕过服务端限流', async () => {
    const env = setup();
    env.fetch.mockResolvedValueOnce({
      ok: false,
      problem: 'rateLimited',
      retryAt: Date.now() + 60_000,
    });
    await tick();
    env.store.set(env.apiKey, 'another');
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', problem: 'rateLimited', tracks: [] });
  });
  it('关着、没认定或没填 key 时不请求；填了 key 停够时间后取，与本地比对', async () => {
    const env = setup();
    env.store.set(env.apiKey, '');
    await tick();
    expect(env.state().status).toBe('noKey');
    env.store.set(env.enabled, false);
    expect(env.state().status).toBe('off');
    env.store.set(env.enabled, true);
    env.store.set(env.apiKey, 'k');
    await tick();
    expect(env.fetch).toHaveBeenCalledWith('Nujabes', 'k', expect.anything());
    const state = env.state();
    expect(state.status).toBe('ready');
    expect(state.tracks[0]?.local?.title).toBe('Feather');
    expect(state.missingAlbums.map((album) => album.title)).toEqual(['Spiritual State']);
    expect(state.similar[0]?.local).toBe('Uyama Hiroto');
  });

  it('看过的几位留在内存里，回来不重复请求；失败到 retryAt 前不重试，主动刷新马上重试', async () => {
    const env = setup();
    await tick();
    env.store.set(env.sourceArtist, 'Shing02');
    env.fetch.mockResolvedValueOnce({
      ok: false,
      problem: 'network',
      retryAt: Date.now() + 60_000,
    });
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', problem: 'network' });
    env.store.set(env.sourceArtist, 'Nujabes');
    await tick();
    expect(env.state().status).toBe('ready');
    env.store.set(env.sourceArtist, 'Shing02');
    await tick();
    expect(env.state().status).toBe('failed');
    expect(env.fetch).toHaveBeenCalledTimes(2);
    env.service.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.fetch).toHaveBeenCalledTimes(3);
    expect(env.state().status).toBe('ready');
  });

  it('换人时上一位晚到的结果不采用', async () => {
    const env = setup();
    let release: (value: Awaited<ReturnType<Fetch>>) => void = () => {};
    env.fetch.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await tick();
    env.fetch.mockResolvedValueOnce({
      ok: false,
      problem: 'network',
      retryAt: Date.now() + 60_000,
    });
    env.store.set(env.sourceArtist, 'Shing02');
    await tick();
    expect(env.fetch).toHaveBeenLastCalledWith('Shing02', 'k', expect.anything());
    expect(env.state()).toMatchObject({ status: 'failed', tracks: [] });
    release(TOPS);
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', tracks: [] });
  });
});
