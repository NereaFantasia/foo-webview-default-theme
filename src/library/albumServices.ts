import type { ConfigWriter } from '../host/configWrite.ts';
import { fb } from 'foo-webview-sdk/bridge';
import type { DragOutService } from '../host/dragOut.ts';
import type { Store } from '../kit/store.ts';
import type { TrackActionsService } from '../track/trackActions.ts';
import {
  startAlbumActions,
  type AlbumActionsFace,
  type AlbumActionsService,
} from './albumActions.ts';
import {
  startAlbumBrowse,
  type AlbumBrowseFace,
  type AlbumBrowseService,
} from './albums/albumBrowse.ts';
import { startAlbumCovers, type AlbumCoversFace, type AlbumCoversService } from './albumCovers.ts';
import { startAlbumDrag, type AlbumDragFace, type AlbumDragService } from './albumDrag.ts';
import {
  startDropdownTracks,
  type DropdownTracksFace,
  type DropdownTracksService,
} from './album-wall/dropdown/albumDropdownTracks.ts';
import { startAlbumMenu, type AlbumMenuFace, type AlbumMenuService } from './albumMenu.ts';
import { startAlbumSelection, type AlbumSelectionService } from './albums/albumSelection.ts';
import { startBrowserPrefs, type BrowserPrefsService } from './albums/browserPrefs.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/** 专辑页用到的服务。随页面存活，离开专辑页也不停：回来时清单、封面与折叠都还在手上。 */
export interface AlbumServices {
  readonly prefs: BrowserPrefsService;
  readonly browse: AlbumBrowseService;
  readonly selection: AlbumSelectionService;
  readonly covers: AlbumCoversService;
  readonly menu: AlbumMenuService;
  readonly actions: AlbumActionsService;
  readonly drag: AlbumDragService;
  /** 封面墙下拉里的曲目。 */
  readonly dropdown: DropdownTracksService;
  /** 按启动的逆序释放。 */
  dispose(): void;
}

export type AlbumServicesFace = AlbumBrowseFace &
  AlbumCoversFace &
  AlbumMenuFace &
  AlbumActionsFace &
  AlbumDragFace &
  DropdownTracksFace;

/**
 * 启动专辑页的各服务。它们共用一个 `store`，彼此只经原子读写，不直接互调：浏览读偏好里的分节与排序，
 * 多选读浏览算出的可见顺序，原子都有初值，所以起的先后只影响发请求的先后。逆序释放只是约定。
 * 拖出凭证由整个窗口的 `dragOut` 协调，起播、入队与发送经整页共用的 `tracks`，都从外面传进来。
 */
export function startAlbumServices(
  store: Store,
  dragOut: DragOutService,
  tracks: TrackActionsService,
  host: AlbumServicesFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): AlbumServices {
  const prefs = startBrowserPrefs(store, host, writer);
  const browse = startAlbumBrowse(store, host, writer);
  const selection = startAlbumSelection(store);
  const covers = startAlbumCovers(store, host);
  const menu = startAlbumMenu(store, host);
  const actions = startAlbumActions(store, tracks, host);
  const drag = startAlbumDrag(dragOut, host);
  const dropdown = startDropdownTracks(store, host);
  return {
    prefs,
    browse,
    selection,
    covers,
    menu,
    actions,
    drag,
    dropdown,
    dispose() {
      dropdown.dispose();
      drag.dispose();
      menu.dispose();
      covers.dispose();
      selection.dispose();
      browse.dispose();
      prefs.dispose();
    },
  };
}

export const albumsKey = serviceKey<AlbumServices>('albums');
