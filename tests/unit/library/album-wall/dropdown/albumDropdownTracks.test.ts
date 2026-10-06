import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  dropdownTracksAtom,
  startDropdownTracks,
} from '../../../../../src/library/album-wall/dropdown/albumDropdownTracks.ts';
import { startAlbums } from '../../../../../src/library/albums.ts';
import { albumKeyOf } from '../../../../../src/host/libraryContract.ts';
import { albumsAnswer, albumTracksAnswer } from '../../../../fixtures/albumLibrary.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { albumRow } from '../../../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../../../fixtures/unitHost.ts';

const A = albumRow('A', 'X');
const B = albumRow('B', 'X');

function setup(host: UnitHost) {
  const store = createStore();
  host.answer('library.getAlbumTracks', albumTracksAnswer);
  const tracks = startDropdownTracks(store, host.fb);
  const titles = (album = A) =>
    store
      .get(dropdownTracksAtom)
      .tracks.get(albumKeyOf(album))
      ?.map((track) => track.title);
  return { store, tracks, titles };
}

describe('startDropdownTracks', () => {
  it('取到的曲目按专辑键放进表里，同时答给调用方', async () => {
    const host = installFakeHost();
    const { tracks, titles } = setup(host);
    const answer = await tracks.load(A);
    expect(answer?.map((track) => track.title)).toEqual(['A 1', 'A 2']);
    expect(titles()).toEqual(['A 1', 'A 2']);
  });

  it('取失败记进失败表、答 null；再取成功就从失败表里拿掉', async () => {
    const host = installFakeHost();
    const { store, tracks, titles } = setup(host);
    host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    expect(await tracks.load(A)).toBeNull();
    expect(store.get(dropdownTracksAtom).failed.has(albumKeyOf(A))).toBe(true);
    host.answer('library.getAlbumTracks', albumTracksAnswer);
    await tracks.load(A);
    expect(store.get(dropdownTracksAtom).failed.size).toBe(0);
    expect(titles()).toEqual(['A 1', 'A 2']);
  });

  it('没连上宿主时不取，答 null', async () => {
    const host = installFakeHost({ available: false });
    const { tracks } = setup(host);
    expect(await tracks.load(A)).toBeNull();
    expect(host.calls).toEqual([]);
  });

  it('表里至多留四张，从最早用到的删起；再取一次算用到', async () => {
    const host = installFakeHost();
    const { store, tracks } = setup(host);
    const albums = ['A', 'B', 'C', 'D', 'E'].map((name) => albumRow(name, 'X'));
    for (const album of albums.slice(0, 4)) await tracks.load(album);
    await tracks.load(albums[0]!);
    await tracks.load(albums[4]!);
    const kept = [...store.get(dropdownTracksAtom).tracks.keys()];
    expect(kept).toEqual(['C', 'D', 'A', 'E'].map((name) => albumKeyOf(albumRow(name, 'X'))));
  });

  it('清单整份换了：表里还在清单里的重取，不在的删掉', async () => {
    const host = installFakeHost();
    host.answer('library.getAlbums', albumsAnswer([A, B]));
    const { store, tracks, titles } = setup(host);
    const albums = startAlbums(store, host.fb);
    await albums.ready;
    await tracks.load(A);
    await tracks.load(B);
    host.answer('library.getAlbums', albumsAnswer([A]));
    const before = host.callsTo('library.getAlbumTracks').length;
    await albums.retry();
    await Promise.resolve();
    expect(titles(B)).toBeUndefined();
    await expect.poll(() => host.callsTo('library.getAlbumTracks').length).toBe(before + 1);
    expect(host.callsTo('library.getAlbumTracks').at(-1)).toEqual({ album: 'A', albumArtist: 'X' });
    expect(titles()).toEqual(['A 1', 'A 2']);
  });

  it('释放之后晚到的应答不再写表', async () => {
    const host = installFakeHost();
    const { tracks, titles } = setup(host);
    const held = host.hold('library.getAlbumTracks');
    const pending = tracks.load(A);
    await expect.poll(() => held.pending.length).toBe(1);
    tracks.dispose();
    held.release();
    await pending;
    expect(titles()).toBeUndefined();
  });
});
