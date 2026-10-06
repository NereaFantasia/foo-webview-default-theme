import type { LibraryTrack } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';
import {
  albumDetailNoticeAtom,
  albumDetailPendingAtom,
  OPEN_SPINNER_DELAY_MS,
  startAlbumDetailOpen,
} from '../../../../src/library/album-detail/albumDetailOpen.ts';
import { fetchAlbumTracks } from '../../../../src/library/albumTracks.ts';
import { albumKeyOf, type Album } from '../../../../src/host/libraryContract.ts';
import { albumTracksAnswer } from '../../../fixtures/albumLibrary.ts';
import type { HostParams } from '../../../fixtures/fakeHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const BLUE = albumRow('Blue', 'Joni');
const HEJIRA = albumRow('Hejira', 'Joni');

function setup() {
  vi.useFakeTimers();
  onTestFinished(() => void vi.useRealTimers());
  const host = installFakeHost();
  host.answer('library.getAlbumTracks', albumTracksAnswer);
  const store = createStore();
  const history = startNavHistory(store);
  const seeded: { album: Album; tracks: readonly LibraryTrack[]; stamp: number }[] = [];
  let stamps = 0;
  const opener = startAlbumDetailOpen(
    store,
    {
      history,
      stamp: () => ++stamps,
      seed: (album, tracks, stamp) => seeded.push({ album, tracks, stamp }),
    },
    host.fb,
  );
  onTestFinished(() => opener.dispose());
  return {
    host,
    store,
    history,
    opener,
    seeded,
    place: () => store.get(historyAtom).place,
    pending: () => store.get(albumDetailPendingAtom),
    notice: () => store.get(albumDetailNoticeAtom),
  };
}

describe('进详情页', () => {
  it('曲目取到了才进，数据连同发请求前的评分戳交给详情页', async () => {
    const { host, opener, seeded, place } = setup();
    const held = host.hold('library.getAlbumTracks');
    opener.open(BLUE);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(place()).toEqual({ id: 'albums' });
    held.release();
    await vi.waitFor(() => expect(place()).toEqual({ id: 'album', subject: albumKeyOf(BLUE) }));
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.tracks.map((track) => track.title)).toEqual(['Blue 1', 'Blue 2']);
    expect(seeded[0]?.stamp).toBe(1);
  });

  it('等过 300 ms 才报被点的是哪一张，到了就撤；早到的不报', async () => {
    const { host, opener, pending, place } = setup();
    const held = host.hold('library.getAlbumTracks');
    opener.open(BLUE);
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS - 10);
    expect(pending()).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(pending()).toEqual({ key: albumKeyOf(BLUE), origin: 'album' });
    held.release();
    await vi.waitFor(() => expect(place().id).toBe('album'));
    expect(pending()).toBeNull();
  });

  it('转圈记着从哪儿点进来的：下拉的 › 与专辑本身分开', async () => {
    const { host, opener, pending } = setup();
    host.hold('library.getAlbumTracks');
    opener.open(BLUE, 'dropdown');
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS + 10);
    expect(pending()).toEqual({ key: albumKeyOf(BLUE), origin: 'dropdown' });
  });

  it('另发一个请求，不等更早发出的那一个：拿到的曲目与发请求前的评分戳对得上', async () => {
    const { host, opener, seeded } = setup();
    const held = host.hold('library.getAlbumTracks');
    const earlier = fetchAlbumTracks(host.fb, BLUE);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    opener.open(BLUE);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    const renamed = (params: HostParams) => {
      const answer = albumTracksAnswer(params);
      if (answer.success === false) throw new Error('替身没给出曲目');
      return { ...answer, tracks: answer.tracks.map((track) => ({ ...track, title: 'after' })) };
    };
    held.respond(0, albumTracksAnswer({ album: 'Blue', albumArtist: 'Joni' }));
    await earlier;
    held.respond(0, renamed({ album: 'Blue', albumArtist: 'Joni' }));
    await vi.waitFor(() => expect(seeded).toHaveLength(1));
    expect(seeded[0]?.tracks.map((track) => track.title)).toEqual(['after', 'after']);
  });

  it('曲目早于 300 ms 到了：一直不报转圈', async () => {
    const { opener, pending, place } = setup();
    opener.open(HEJIRA);
    await vi.waitFor(() => expect(place().id).toBe('album'));
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS * 2);
    expect(pending()).toBeNull();
  });

  it('连点只认最后一次：先点的晚到也不进', async () => {
    const { host, opener, seeded, place, pending } = setup();
    const held = host.hold('library.getAlbumTracks');
    opener.open(BLUE);
    opener.open(HEJIRA);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS + 10);
    expect(pending()).toEqual({ key: albumKeyOf(HEJIRA), origin: 'album' });
    held.respond(1);
    await vi.waitFor(() => expect(place()).toEqual({ id: 'album', subject: albumKeyOf(HEJIRA) }));
    held.respond(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(place()).toEqual({ id: 'album', subject: albumKeyOf(HEJIRA) });
    expect(seeded.map((one) => one.album.name)).toEqual(['Hejira']);
  });

  it('答了空或取失败：只挂提示，不进页面；下一次进成了提示清掉', async () => {
    const { host, opener, place, notice } = setup();
    host.answer('library.getAlbumTracks', (params) => ({
      ...albumTracksAnswer(params),
      tracks: [],
    }));
    opener.open(BLUE);
    await vi.waitFor(() => expect(notice()).toBe('albumDetail.notFound'));
    host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    opener.open(BLUE);
    await vi.waitFor(() => expect(notice()).toBe('albumDetail.openFailed'));
    expect(place()).toEqual({ id: 'albums' });
    opener.dismissNotice();
    expect(notice()).toBeNull();
    host.answer('library.getAlbumTracks', albumTracksAnswer);
    opener.open(BLUE);
    await vi.waitFor(() => expect(place().id).toBe('album'));
    expect(notice()).toBeNull();
  });

  it('等的途中去了别处：到了也不再拉过去，转圈撤掉', async () => {
    const { host, history, opener, seeded, place, pending } = setup();
    const held = host.hold('library.getAlbumTracks');
    opener.open(BLUE);
    await vi.advanceTimersByTimeAsync(OPEN_SPINNER_DELAY_MS + 10);
    expect(pending()).not.toBeNull();
    history.navigate({ id: 'songs' });
    expect(pending()).toBeNull();
    held.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(place()).toEqual({ id: 'songs' });
    expect(seeded).toEqual([]);
  });
});
