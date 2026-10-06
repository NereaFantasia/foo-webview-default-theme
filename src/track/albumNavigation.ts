import type { Atom } from 'jotai/vanilla';
import type { Album, TrackAlbumFields } from '../host/libraryContract.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 曲目菜单的「转到专辑」要用的几样：找曲目所在的专辑、看此刻是否已在它的详情页、进它的详情页。
 * 媒体库以外的业务（播放列表、外壳）经这个键取用，由装配处拿专辑详情服务实现。
 */
export interface AlbumNavigation {
  /** 媒体库的专辑清单；组件读它，清单变了才会重新找专辑。 */
  readonly catalog: Atom<unknown>;
  findAlbum(track: TrackAlbumFields): Album | null;
  isCurrent(album: Album): boolean;
  /** 先取曲目、取到了再进页；取不到只挂提示，不进页面。 */
  open(album: Album): void;
}

export const albumNavigationKey = serviceKey<AlbumNavigation>('albumNavigation');
