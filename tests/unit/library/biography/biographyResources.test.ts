import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startBiographyResources } from '../../../../src/library/biography/biographyResources.ts';
import { startBiography } from '../../../../src/library/biography/biographyService.ts';
import { startBiographyIdentity } from '../../../../src/library/biography/identity/biographyIdentity.ts';
import type {
  BiographyIdentity,
  BiographyInput,
} from '../../../../src/library/biography/biographyModel.ts';
import type { LastfmFetchResult } from '../../../../src/library/biography/fetchLastfmBiography.ts';
import type { MusicbrainzClient } from '../../../../src/library/biography/identity/musicbrainzApi.ts';
import { artistFile, installArtistFiles } from '../../../fixtures/artistFilesHost.ts';
import { biographyDocument } from '../../../fixtures/biographySamples.ts';
import { artistSample, NUJABES } from '../../../fixtures/musicbrainzSamples.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);

function setup() {
  const env = installArtistFiles();
  const store = createStore();
  const resources = startBiographyResources(store, env.host.fb);
  const stops: (() => void)[] = [];
  onTestFinished(() => {
    stops.forEach((stop) => stop());
    resources.dispose();
  });
  env.host.answer('http.get', {
    success: true,
    status: 404,
    headers: {},
    body: '',
    responseType: 'text',
  });
  function biography(
    name: string,
    fetchText = vi.fn(async (): Promise<LastfmFetchResult> => ({
      ok: true,
      store: true,
      entry: {
        artist: name,
        language: 'en',
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        document: biographyDocument(name, 'en', `正文 ${name}`),
      },
    })),
  ) {
    const input = atom<BiographyInput | null>({ artist: name, sourceArtist: name, language: 'en' });
    const service = startBiography(
      store,
      {
        input,
        enabled: atom(true),
        active: atom(true),
        resources,
        fetchText,
      },
      env.host.fb,
    );
    stops.push(service.dispose);
    return { service, input, fetchText, state: () => store.get(service.state) };
  }
  function identity(
    name: string,
    client: MusicbrainzClient = { request: async () => ({ kind: 'data', data: { artists: [] } }) },
  ) {
    const service = startBiographyIdentity(
      store,
      {
        artist: atom(name),
        albums: atom<readonly string[]>([]),
        manual: atom<BiographyIdentity | null>(null),
        enabled: atom(true),
        active: atom(true),
        locale: atom('en'),
        resources,
      },
      client,
      env.host.fb,
    );
    stops.push(service.dispose);
    return service;
  }
  return { ...env, store, resources, biography, identity };
}

describe('简介共享资源', () => {
  it('同一艺人的两个视图合并正文请求并都得到结果', async () => {
    const env = setup();
    let finish: (result: LastfmFetchResult) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<LastfmFetchResult>((resolve) => {
          finish = resolve;
        }),
    );
    const a = env.biography('A', fetch);
    const b = env.biography('A', fetch);
    await Promise.all([a.service.ready, b.service.ready]);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    finish({
      ok: true,
      store: true,
      entry: {
        artist: 'A',
        language: 'en',
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        document: biographyDocument('A', 'en', '共享正文'),
      },
    });
    await tick();
    expect(a.state().document?.paragraphs).toEqual(['共享正文']);
    expect(b.state().document?.paragraphs).toEqual(['共享正文']);
    expect(env.resources.cache.get('A', 'en')?.document?.paragraphs).toEqual(['共享正文']);
  });
  it('手选身份写缓存期间清理，写完也不能把旧手选结果交给偏好', async () => {
    const env = setup();
    const service = env.identity('Nujabes', {
      request: async () => ({ kind: 'data', data: artistSample() }),
    });
    await service.ready;
    await tick();
    const held = env.host.hold('file.write');
    const picked = service.pick(NUJABES);
    await vi.advanceTimersByTimeAsync(0);
    expect(held.pending).toHaveLength(1);
    const cleared = service.clearCache();
    held.release();
    expect(await picked).toBeNull();
    expect(await cleared).toBe(true);
    expect(env.resources.identityCache.get('Nujabes')).toBeUndefined();
  });
  it('两个主体共用正文与身份缓存，释放一方后另一方仍能读写', async () => {
    const env = setup();
    const a = env.biography('A');
    const b = env.biography('B');
    const ia = env.identity('A');
    const ib = env.identity('B');
    await Promise.all([a.service.ready, b.service.ready, ia.ready, ib.ready]);
    await tick();
    expect(a.state().document?.artist).toBe('A');
    expect(b.state().document?.artist).toBe('B');
    for (const file of ['lastfm-v1.json', 'musicbrainz-v1.json']) {
      const saved = env.files.get(artistFile(file)) ?? '';
      expect(saved).toContain('"artist":"A"');
      expect(saved).toContain('"artist":"B"');
    }
    a.service.dispose();
    ia.dispose();
    b.service.refresh();
    ib.refresh();
    await tick();
    expect(b.state().document?.artist).toBe('B');
    expect(env.store.get(b.service.cacheState)).toMatchObject({ count: 2, failed: false });
    expect(env.resources.identityCache.get('B')?.status).toBe('none');
  });

  it('一方清理时两方撤下正文，另一方晚到的正文不能写回', async () => {
    const env = setup();
    const a = env.biography('A');
    let resolve: (value: LastfmFetchResult) => void = () => {};
    const b = env.biography(
      'B',
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    await Promise.all([a.service.ready, b.service.ready]);
    await tick();
    expect(await a.service.clearCache()).toBe(true);
    resolve({
      ok: true,
      store: true,
      entry: {
        artist: 'B',
        language: 'en',
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 1000,
        document: biographyDocument('B', 'en', '晚到正文'),
      },
    });
    await tick();
    expect(a.state()).toMatchObject({ status: 'cleared', document: null });
    expect(b.state()).toMatchObject({ status: 'cleared', document: null });
    expect(env.files.get(artistFile('lastfm-v1.json'))).toBe('{"version":1,"entries":[]}');
  });

  it('清理身份缓存会撤销另一方在途的认定，晚到结果不能写回', async () => {
    const env = setup();
    let release: (value: Awaited<ReturnType<MusicbrainzClient['request']>>) => void = () => {};
    const a = env.identity('A');
    const b = env.identity('B', {
      request: () =>
        new Promise((done) => {
          release = done;
        }),
    });
    await Promise.all([a.ready, b.ready]);
    await tick();
    expect(await a.clearCache()).toBe(true);
    release({ kind: 'data', data: { artists: [] } });
    await tick();
    expect(env.store.get(b.state)).toEqual({ artist: 'B', status: 'idle' });
    expect(env.files.get(artistFile('musicbrainz-v1.json'))).toBe('{"version":1,"entries":[]}');
  });

  it('两个消费者经同一 MusicBrainz 队列发请求，开始时间至少相隔 1.1 秒', async () => {
    const env = setup();
    const started: number[] = [];
    env.host.answer('http.get', () => {
      started.push(Date.now());
      return {
        success: true,
        status: 200,
        headers: {},
        body: '{"artists":[]}',
        responseType: 'text',
      };
    });
    const a = env.identity('A', env.resources.musicbrainz);
    const b = env.identity('B', env.resources.musicbrainz);
    await Promise.all([a.ready, b.ready]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(env.store.get(a.state).status).toBe('none');
    expect(env.store.get(b.state).status).toBe('none');
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(1100);
  });
});
