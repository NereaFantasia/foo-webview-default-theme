import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { BiographyIdentity } from '../../../../../src/library/biography/biographyModel.ts';
import { startBiographyIdentity } from '../../../../../src/library/biography/identity/biographyIdentity.ts';
import { IDENTITY_CACHE_FILE } from '../../../../../src/library/biography/identity/identityRecord.ts';
import type { MusicbrainzResult } from '../../../../../src/library/biography/identity/musicbrainzApi.ts';
import { artistFile, installArtistFiles } from '../../../../fixtures/artistFilesHost.ts';
import {
  artistSample,
  candidateSample,
  NUJABES,
  OTHER_NUJABES,
  releaseGroupsSample,
  searchSample,
} from '../../../../fixtures/musicbrainzSamples.ts';

const FILE = artistFile(IDENTITY_CACHE_FILE);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);

const data = (value: Readonly<Record<string, unknown>>): MusicbrainzResult => ({
  kind: 'data',
  data: value,
});

const ANSWERS: Readonly<Record<string, MusicbrainzResult>> = {
  artist: data(
    searchSample(candidateSample(NUJABES, 'Nujabes'), candidateSample(OTHER_NUJABES, 'Nujabes')),
  ),
  [`release-group:${NUJABES}`]: data(releaseGroupsSample('Modal Soul')),
  [`release-group:${OTHER_NUJABES}`]: data(releaseGroupsSample('Snow')),
  [`artist/${NUJABES}`]: data(artistSample()),
  [`artist/${OTHER_NUJABES}`]: data(
    artistSample(OTHER_NUJABES, {
      relations: [{ type: 'last.fm', url: { resource: 'https://www.last.fm/music/Nujabes+(2)' } }],
    }),
  ),
};

function setup(files: Readonly<Record<string, string>> = {}) {
  const { host, files: stored } = installArtistFiles(files);
  const store = createStore();
  const artist = atom<string | null>('Nujabes');
  const albums = atom<readonly string[] | null>(['Modal Soul']);
  const manual = atom<BiographyIdentity | null>(null);
  const enabled = atom(true);
  const active = atom(true);
  const answers: Record<string, MusicbrainzResult> = { ...ANSWERS };
  const request = vi.fn(
    async (path: string, params: Readonly<Record<string, string>>, alive?: () => boolean) => {
      if (alive && !alive()) return { kind: 'failed', problem: 'network', retryAt: 0 } as const;
      const key = path === 'release-group' ? `release-group:${params['artist']}` : path;
      return answers[key] ?? ({ kind: 'missing' } as const);
    },
  );
  const deps = { artist, albums, manual, enabled, active, locale: atom('en') };
  const service = startBiographyIdentity(store, deps, { request }, host.fb);
  onTestFinished(() => service.dispose());
  return {
    ...deps,
    store,
    service,
    request,
    answers,
    stored,
    state: () => store.get(service.state),
    paths: () => request.mock.calls.map((call) => call[0]),
  };
}

describe('身份认定服务', () => {
  it('自动认定后写进缓存；重开时直接用缓存，不再请求', async () => {
    const env = setup();
    await env.service.ready;
    await tick();
    expect(env.state()).toMatchObject({
      artist: 'Nujabes',
      status: 'resolved',
      mbid: NUJABES,
      sourceArtist: 'Nujabes',
      manual: false,
    });
    expect(env.paths()).toEqual(['artist', 'release-group', 'release-group', `artist/${NUJABES}`]);
    const saved = env.stored.get(FILE) ?? '';
    expect(saved).toContain(NUJABES);
    const again = setup({ [FILE]: saved });
    await again.service.ready;
    await tick();
    expect(again.state()).toMatchObject({ status: 'resolved', mbid: NUJABES });
    expect(again.request).not.toHaveBeenCalled();
  });

  it('关着或不在显示时不请求；媒体库没读完时等着，读完再认定', async () => {
    const env = setup();
    env.store.set(env.albums, null);
    env.store.set(env.active, false);
    await tick();
    expect(env.request).not.toHaveBeenCalled();
    env.store.set(env.active, true);
    await tick();
    expect(env.state().status).toBe('resolving');
    expect(env.request).not.toHaveBeenCalled();
    env.store.set(env.albums, ['Modal Soul']);
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', mbid: NUJABES });
  });

  it('手选的为准：没有 MBID 时不请求；有 MBID 时只取资料', async () => {
    const env = setup();
    env.store.set(env.manual, { artist: 'Nujabes', sourceArtist: 'Nujabes (2)' });
    await tick();
    expect(env.state()).toMatchObject({
      status: 'resolved',
      sourceArtist: 'Nujabes (2)',
      mbid: null,
      manual: true,
      facts: [],
    });
    expect(env.request).not.toHaveBeenCalled();
    env.store.set(env.manual, { artist: 'Nujabes', sourceArtist: 'Nujabes', mbid: NUJABES });
    await tick();
    expect(env.paths()).toEqual([`artist/${NUJABES}`]);
    expect(env.state()).toMatchObject({ manual: true, mbid: NUJABES });
    const state = env.state();
    expect(state.status === 'resolved' && state.facts.length).toBeGreaterThan(0);
  });

  it('失败不缓存，退避期内换回来不重试，主动刷新马上重试', async () => {
    const env = setup();
    env.answers['artist'] = { kind: 'failed', problem: 'network', retryAt: Date.now() + 60_000 };
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', problem: 'network' });
    expect(env.stored.get(FILE)).toBeUndefined();
    env.store.set(env.artist, 'Other');
    await tick();
    env.store.set(env.artist, 'Nujabes');
    await tick();
    expect(env.state()).toMatchObject({ artist: 'Nujabes', status: 'failed' });
    expect(env.paths().filter((path) => path === 'artist')).toHaveLength(2);
    env.answers['artist'] = ANSWERS['artist'] ?? { kind: 'missing' };
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved' });
  });

  it('「不是这位」直接列出认定时的候选；选中一位后存下并交回他的 Last.fm 名字', async () => {
    const env = setup();
    await tick();
    const before = env.request.mock.calls.length;
    env.service.reject();
    expect(env.state()).toMatchObject({ status: 'ambiguous' });
    await tick();
    expect(env.request.mock.calls.length).toBe(before);
    expect(await env.service.pick(OTHER_NUJABES)).toEqual({
      sourceArtist: 'Nujabes (2)',
      mbid: OTHER_NUJABES,
    });
    expect(env.stored.get(FILE)).toContain('Nujabes (2)');
    env.store.set(env.manual, {
      artist: 'Nujabes',
      sourceArtist: 'Nujabes (2)',
      mbid: OTHER_NUJABES,
    });
    await tick();
    expect(env.state()).toMatchObject({ manual: true, mbid: OTHER_NUJABES });
    expect(env.request.mock.calls.length).toBe(before + 1);
  });

  it('换人时上一位的晚到结果不采用，状态先换成新的这位', async () => {
    const env = setup();
    let release: (value: MusicbrainzResult) => void = () => {};
    env.request.mockImplementationOnce(
      () => new Promise<MusicbrainzResult>((resolve) => (release = resolve)),
    );
    await tick();
    env.store.set(env.artist, 'Fat Jon');
    expect(env.state()).toMatchObject({ artist: 'Fat Jon', status: 'idle' });
    release(ANSWERS['artist'] ?? { kind: 'missing' });
    await tick();
    expect(env.state().artist).toBe('Fat Jon');
    expect(env.state().status).not.toBe('resolved');
  });

  it('清理缓存后文件只剩空清单', async () => {
    const env = setup();
    await tick();
    expect(await env.service.clearCache()).toBe(true);
    expect(JSON.parse(env.stored.get(FILE) ?? '{}')).toEqual({ version: 1, entries: [] });
  });
});
