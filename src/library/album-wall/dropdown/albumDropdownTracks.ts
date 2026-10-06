import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import type { HostReadyFace } from '../../../host/waitForHost.ts';
import type { Store } from '../../../kit/store.ts';
import { albumsAtom } from '../../albums.ts';
import { fetchAlbumTracks, type AlbumTracksFace } from '../../albumTracks.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../../host/libraryContract.ts';

/**
 * 表里至多留几张。换到别的行时收起的那条与展开的那条同时在画，连点几张时还有几张在路上，
 * 四张够用；再多的从最早用到的删起。
 */
const KEEP = 4;

/** 下拉里画的曲目，按专辑键；取失败的另记一份，画失败提示而不是一直画骨架。 */
export interface DropdownTracksState {
  readonly tracks: ReadonlyMap<AlbumKey, readonly LibraryTrack[]>;
  readonly failed: ReadonlySet<AlbumKey>;
}

const EMPTY: DropdownTracksState = { tracks: new Map(), failed: new Set() };
const stateAtom = atom<DropdownTracksState>(EMPTY);

export const dropdownTracksAtom: Atom<DropdownTracksState> = atom((get) => get(stateAtom));

export interface DropdownTracksFace extends Pick<HostReadyFace, 'isAvailable'>, AlbumTracksFace {}

export interface DropdownTracksService {
  /**
   * 取一张专辑的曲目放进表里，答取到的曲目；失败或没连上宿主答 null。已在表里的照样重取：展开一次
   * 就核对一次，库变了也跟得上。取的途中表里留着旧的，下拉不退回骨架。
   */
  load(album: Album): Promise<readonly LibraryTrack[] | null>;
  dispose(): void;
}

/**
 * 启动封面墙下拉的曲目表。清单整份换了（库变了）就重取表里的每一张，不在新清单里的删掉：下拉按专辑
 * 是否还在条目流里决定收不收，曲目表只管跟上。晚到的旧应答丢掉。
 */
export function startDropdownTracks(
  store: Store,
  host: DropdownTracksFace = fb,
): DropdownTracksService {
  store.set(stateAtom, EMPTY);
  let disposed = false;
  let generation = 0;
  /** 表里每张最近一次发出的那一发；对不上的应答是旧的。 */
  const latest = new Map<AlbumKey, number>();
  let list = store.get(albumsAtom).albums;

  function update(key: AlbumKey, tracks: readonly LibraryTrack[] | null): void {
    const state = store.get(stateAtom);
    const nextTracks = new Map(state.tracks);
    const nextFailed = new Set(state.failed);
    nextTracks.delete(key);
    nextFailed.delete(key);
    if (tracks) nextTracks.set(key, tracks);
    else nextFailed.add(key);
    for (const oldest of nextTracks.keys()) {
      if (nextTracks.size <= KEEP) break;
      nextTracks.delete(oldest);
    }
    store.set(stateAtom, { tracks: nextTracks, failed: nextFailed });
  }

  async function load(album: Album): Promise<readonly LibraryTrack[] | null> {
    if (disposed || !host.isAvailable()) return null;
    const key = albumKeyOf(album);
    const mine = ++generation;
    latest.set(key, mine);
    const tracks = await settle(() => fetchAlbumTracks(host, album));
    if (disposed || latest.get(key) !== mine) return tracks;
    update(key, tracks);
    return tracks;
  }

  const offAlbums = store.sub(albumsAtom, () => {
    const next = store.get(albumsAtom).albums;
    if (next === list) return;
    list = next;
    const state = store.get(stateAtom);
    const known = new Set([...state.tracks.keys(), ...state.failed]);
    if (known.size === 0) return;
    const byKey = new Map(next.map((album) => [albumKeyOf(album), album]));
    const kept = new Map([...state.tracks].filter(([key]) => byKey.has(key)));
    const failed = new Set([...state.failed].filter((key) => byKey.has(key)));
    store.set(stateAtom, { tracks: kept, failed });
    for (const key of known) {
      const album = byKey.get(key);
      if (album) void load(album);
      else latest.delete(key);
    }
  });

  return {
    load,
    dispose() {
      disposed = true;
      offAlbums();
    },
  };
}
