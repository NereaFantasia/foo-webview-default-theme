import type { LibraryTrack } from 'foo-webview-sdk';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { Store } from '../../kit/store.ts';
import { objectPendingAtom, type KindOpener } from '../../nav/objectOpener.ts';
import type { ObjectRef } from '../../nav/objectRef.ts';
import { albumsAtom, type AlbumsState } from '../albums.ts';
import { fetchAlbumTracks, type AlbumTracksFace } from '../albumTracks.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';

/** 从哪儿点进来的：下拉里的 › 键，或者这张专辑本身（封面、专辑名、专辑菜单）。转圈出在被点的那一处 */
export type AlbumOpenOrigin = 'dropdown' | 'album';

export interface AlbumOpening {
  readonly key: AlbumKey;
  readonly origin: AlbumOpenOrigin;
}

/** 正在为进哪一张的详情页取曲目、而且已经等过了转圈的延迟：被点处据此出小转圈 */
export const albumDetailPendingAtom: Atom<AlbumOpening | null> = atom((get) => {
  const opening = get(objectPendingAtom);
  if (opening?.ref.kind !== 'album') return null;
  return { key: opening.ref.key, origin: opening.origin === 'dropdown' ? 'dropdown' : 'album' };
});

/** 同一份清单只建一次索引：表格每个可见行渲染时都要按键找专辑 */
const indexes = new WeakMap<readonly Album[], ReadonlyMap<string, Album>>();

/**
 * 这张在清单里：答那一行；清单读回了而没有答 null；还说不准（没读回、读失败了）答 undefined
 * 清单截断时排在截断之后的专辑也算不在：页头要的年份、封面都来自清单里的那一行
 */
export function listedAlbum(state: AlbumsState, key: string): Album | null | undefined {
  let index = indexes.get(state.albums);
  if (!index) {
    index = new Map(state.albums.map((album) => [albumKeyOf(album), album]));
    indexes.set(state.albums, index);
  }
  return index.get(key) ?? (state.status === 'ready' ? null : undefined);
}

type AlbumRef = Extract<ObjectRef, { kind: 'album' }>;

export interface AlbumKind extends KindOpener<AlbumRef> {
  /** 调用方手上已有这一行：清单正在重读、按键找不到时用它 */
  hand(album: Album): void;
}

export interface AlbumKindDeps {
  readonly stamp: () => number;
  /** 取到的曲目交给详情页的数据服务，进页之后不必再取。`stamp` 是发请求前拿的评分戳 */
  readonly seed: (album: Album, tracks: readonly LibraryTrack[], stamp: number) => void;
}

/** 专辑怎么打开：先取曲目，取到了交给详情页再进；取不到或答了空只挂提示 */
export function albumKind(store: Store, deps: AlbumKindDeps, host: AlbumTracksFace): AlbumKind {
  let handed: Album | null = null;
  return {
    revision: albumsAtom,
    availability(ref) {
      const album = listedAlbum(store.get(albumsAtom), ref.key);
      return album ? 'ready' : album === null ? 'missing' : 'pending';
    },
    hand(album) {
      handed = album;
    },
    async prepare(ref) {
      const album =
        listedAlbum(store.get(albumsAtom), ref.key) ??
        (handed && albumKeyOf(handed) === ref.key ? handed : null);
      if (!album) return { ok: false, result: 'missing', notice: 'albumDetail.notFound' };
      // 另发一个请求，不等更早发出的：曲目要与这一刻拿的评分戳对得上
      const stamp = deps.stamp();
      const tracks = await settle(() => fetchAlbumTracks(host, album, { fresh: true }));
      if (!tracks) return { ok: false, result: 'failed', notice: 'albumDetail.openFailed' };
      if (tracks.length === 0)
        return { ok: false, result: 'missing', notice: 'albumDetail.notFound' };
      return { ok: true, enter: () => deps.seed(album, tracks, stamp) };
    },
  };
}
