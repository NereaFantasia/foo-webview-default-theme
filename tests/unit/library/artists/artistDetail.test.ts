import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AlbumsState } from '../../../../src/library/albums.ts';
import {
  artistSections,
  DETAIL_DEBOUNCE_MS,
  readTopPlayed,
  startArtistDetail,
  summarizeArtist,
} from '../../../../src/library/artists/artistDetail.ts';
import type { CreditedArtistsState } from '../../../../src/library/artists/artistIndex.ts';
import {
  ARTIST_ALBUMS,
  artistAlbumTracks,
  NUJABES_CREDITS,
  readyAlbums,
} from '../../../fixtures/artistsLibrary.ts';
import type { HostParams } from '../../../fixtures/fakeHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => vi.advanceTimersByTimeAsync(DETAIL_DEBOUNCE_MS + 1);

/** 按路径里的曲名答播放次数；`resultOf` 不认识的曲目答 `fallback`。 */
function evalAnswer(params: HostParams, resultOf: (path: string) => string) {
  const paths = (Array.isArray(params['paths']) ? params['paths'] : []).map(String);
  return {
    success: true as const,
    pattern: String(params['pattern']),
    total: paths.length,
    successCount: paths.length,
    errorCount: 0,
    results: paths.map((path) => ({ path, success: true, result: resultOf(path) })),
  };
}

function plays(counts: Readonly<Record<string, string>>) {
  return (params: HostParams) =>
    evalAnswer(params, (path) => {
      const key = Object.keys(counts).find((title) => path.includes(title));
      return key ? (counts[key] ?? '') : '0';
    });
}

function setup() {
  const host = installFakeHost();
  host.answer('library.getAlbumTracks', artistAlbumTracks);
  host.answer('titleformat.evalBatch', plays({ Feather: '41', 'Luv(sic) Part 3': '48' }));
  const store = createStore();
  const subject = atom<string | null>('Nujabes');
  const albums = atom<AlbumsState>(readyAlbums());
  const credited = atom<CreditedArtistsState>({
    status: 'ready',
    rows: [NUJABES_CREDITS],
    truncated: false,
  });
  const active = atom(true);
  const service = startArtistDetail(store, { subject, albums, credited, active }, host.fb);
  onTestFinished(() => service.dispose());
  return {
    host,
    store,
    subject,
    albums,
    credited,
    active,
    service,
    state: () => store.get(service.state),
  };
}

describe('艺人右半', () => {
  it('切页和换人后同步复用常听与专辑，媒体库变化才重取', async () => {
    const env = setup();
    await settle();
    const old = env.state();
    const count = env.host.callsTo('library.getAlbumTracks').length;
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    expect(env.state()).toBe(old);
    await settle();
    expect(env.host.callsTo('library.getAlbumTracks')).toHaveLength(count);
    env.store.set(env.subject, 'Shing02');
    await settle();
    env.store.set(env.subject, 'Nujabes');
    expect(env.state()).toBe(old);
    env.store.set(env.albums, {
      ...env.store.get(env.albums),
      albums: [...env.store.get(env.albums).albums],
    });
    await settle();
    expect(env.state().detail).not.toBe(old.detail);
    expect(env.state().plays.status).toBe('ready');
  });
  it('完整旧表重取全部失败时报告刷新失败，成功后清除标记', async () => {
    const env = setup();
    await settle();
    const previous = env.state().detail;
    expect(previous?.own.length).toBeGreaterThan(0);
    env.host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    env.service.refresh();
    await settle();
    expect(env.state()).toMatchObject({ status: 'ready', partial: false, refreshFailed: true });
    expect(env.state().detail).toBe(previous);
    env.host.answer('library.getAlbumTracks', artistAlbumTracks);
    env.service.refresh();
    await settle();
    expect(env.state()).toMatchObject({ status: 'ready', refreshFailed: false });
  });
  it('「专辑」节是专辑艺术家等于他的，「参与」节是他署名过的其余专辑，都按年份排', () => {
    const sections = artistSections('Nujabes', ARTIST_ALBUMS, NUJABES_CREDITS);
    expect(sections.own.map((album) => album.name)).toEqual(['Metaphorical Music', 'Modal Soul']);
    expect(sections.guest.map((album) => album.name)).toEqual(['Luv(sic) Hexalogy']);
    expect(artistSections('Nujabes', ARTIST_ALBUMS, undefined).guest).toEqual([]);
  });

  it('统计与常合作：常合作按一起署名的曲目数，不含他自己', () => {
    const own = [{ album: albumNamed('Modal Soul'), tracks: artistTracks('Modal Soul') }];
    const guest = [
      {
        album: albumNamed('Luv(sic) Hexalogy'),
        tracks: artistTracks('Luv(sic) Hexalogy').slice(0, 1),
      },
    ];
    const result = summarizeArtist('Nujabes', own, guest);
    expect(result.summary).toEqual({
      ownAlbums: 1,
      guestAlbums: 1,
      tracks: 3,
      duration: 540,
      firstYear: '2005',
      lastYear: '2013',
    });
    expect(result.collaborators).toEqual([
      { name: 'Akin', tracks: 1 },
      { name: 'Cise Starr', tracks: 1 },
      { name: 'Shing02', tracks: 1 },
    ]);
  });

  it('常听取次数大于 0 的前几首；全都读不出次数或调用失败时是取不到，不当作没听过', async () => {
    const host = installFakeHost();
    host.answer('titleformat.evalBatch', plays({ Feather: '3', Kumomi: '9' }));
    const tracks = [...artistTracks('Modal Soul'), ...artistTracks('Metaphorical Music')];
    const ready = await readTopPlayed(host.fb, tracks);
    expect(
      ready?.status === 'ready' && ready.top.map((item) => [item.track.title, item.plays]),
    ).toEqual([
      ['Kumomi', 9],
      ['Feather', 3],
    ]);
    host.answer('titleformat.evalBatch', (params) => evalAnswer(params, () => ''));
    expect(await readTopPlayed(host.fb, tracks)).toEqual({ status: 'unavailable' });
    host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
    expect(await readTopPlayed(host.fb, tracks)).toEqual({ status: 'unavailable' });
  });

  it('停够时间才取；「参与」组只留他署名的曲目；曲目齐了再读常听', async () => {
    const env = setup();
    expect(env.state()).toMatchObject({ status: 'loading', subject: 'Nujabes' });
    expect(env.host.callsTo('library.getAlbumTracks')).toHaveLength(0);
    await settle();
    const state = env.state();
    expect(state.status).toBe('ready');
    expect(state.detail?.own.map((group) => group.album.name)).toEqual([
      'Metaphorical Music',
      'Modal Soul',
    ]);
    expect(state.detail?.guest[0]?.tracks.map((track) => track.title)).toEqual(['Luv(sic) Part 3']);
    expect(state.detail?.summary).toMatchObject({ ownAlbums: 2, guestAlbums: 1, tracks: 5 });
    expect(state.plays).toMatchObject({
      status: 'ready',
      top: [{ plays: 48 }, { plays: 41 }],
    });
    expect(env.host.callsTo('library.getAlbumTracks')).toHaveLength(3);
  });

  it('换人时立刻撤掉上一位，晚到的曲目不采用；不显示时不取', async () => {
    const env = setup();
    const held = env.host.hold('library.getAlbumTracks');
    await settle();
    expect(held.pending.length).toBeGreaterThan(0);
    env.store.set(env.subject, 'Shing02');
    expect(env.state()).toMatchObject({ subject: 'Shing02', detail: null });
    held.release();
    await settle();
    expect(env.state().detail?.subject).toBe('Shing02');
    expect(env.state().detail?.own.map((group) => group.album.name)).toEqual(['Luv(sic) Hexalogy']);
    env.store.set(env.active, false);
    env.store.set(env.subject, 'Fat Jon');
    await settle();
    expect(env.state()).toMatchObject({ subject: 'Fat Jon', detail: null });
  });

  it('有几张取不到时照出其余并标出缺；同一位重取全失败留着旧表；署名清单没到时「参与」先空着', async () => {
    const env = setup();
    env.host.answer('library.getAlbumTracks', (params) =>
      params['album'] === 'Modal Soul'
        ? hostFailure('OPERATION_FAILED')
        : artistAlbumTracks(params),
    );
    await settle();
    expect(env.state()).toMatchObject({ status: 'ready', partial: true });
    expect(env.state().detail?.own.map((group) => group.album.name)).toEqual([
      'Metaphorical Music',
    ]);
    env.host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    env.service.refresh();
    await settle();
    expect(env.state().status).toBe('ready');
    expect(env.state().detail?.own).toHaveLength(1);
    env.host.answer('library.getAlbumTracks', artistAlbumTracks);
    env.store.set(env.credited, { status: 'loading', rows: null, truncated: false });
    await settle();
    expect(env.state()).toMatchObject({ guestPending: true, partial: false });
    expect(env.state().detail?.guest).toEqual([]);
  });
});

function artistTracks(album: string) {
  const answer = artistAlbumTracks({ album, albumArtist: '' });
  return answer.success ? answer.tracks : [];
}

function albumNamed(name: string) {
  const album = ARTIST_ALBUMS.find((item) => item.name === name);
  if (!album) throw new Error(`夹具里没有 ${name}`);
  return album;
}
