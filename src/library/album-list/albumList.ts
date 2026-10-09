import type { ConfigWriter } from '../../host/configWrite.ts';
import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigPrefFace } from '../../host/configPref.ts';
import type { Store } from '../../kit/store.ts';
import { createRowSelection, type RowSelection } from '../../table/rowSelection.ts';
import { albumBrowseAtom } from '../albums/albumBrowse.ts';
import { buildListOrders, type AlbumListOrders } from './albumListModel.ts';
import type { CollapsedSections } from '../albums/collapsedSections.ts';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import {
  libraryTracksAtom,
  startLibraryTracks,
  type LibraryTracksFace,
  type LibraryTracksService,
} from '../libraryTracks.ts';
import { createListFolding, type ListFolding } from './listFolding.ts';
import { listPrefsAtom, startListPrefs, type ListPrefsService } from './listPrefs.ts';
import { isStatsField, orderSections, sortListAlbums } from './listSort.ts';
import {
  playStatsAtom,
  startPlayStats,
  type PlayStatsFace,
  type PlayStatsService,
} from '../playStats.ts';
import { startTrackMenu, type TrackMenuFace, type TrackMenuService } from '../trackMenu.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

/**
 * 列表形态的行序号：浏览给的节（已过滤、分好节）按列表形态自己的排序与节序重排，再排上曲目。按播放统计排序时
 * 才读统计：别的排序下统计到了也不重排。
 */
export const albumListOrdersAtom: Atom<AlbumListOrders> = atom((get) => {
  const { sections, headers } = get(albumBrowseAtom);
  const { sort, seed, sectionOrder } = get(listPrefsAtom);
  const { byAlbum } = get(libraryTracksAtom);
  const stats = isStatsField(sort.field) ? get(playStatsAtom).byHandle : null;
  const context = {
    tracksOf: (album: Album) => byAlbum.get(albumKeyOf(album)),
    statsOf: (track: LibraryTrack) => stats?.get(track.handle),
    seed,
  };
  const sorted = sections.map((section) => ({
    key: section.key,
    albums: sortListAlbums(section.albums, sort, context),
  }));
  return buildListOrders(orderSections(sorted, sectionOrder), headers, context.tracksOf);
});

export interface AlbumListDeps {
  /** 评分服务的戳，取曲目前拿一个。 */
  readonly stamp: () => number;
  /** 改折叠存档的整份，见 `AlbumBrowseService.updateCollapsed`。 */
  readonly updateCollapsed: (change: (value: CollapsedSections) => CollapsedSections) => void;
}

export type AlbumListFace = LibraryTracksFace & PlayStatsFace & TrackMenuFace & ConfigPrefFace;

export interface AlbumListServices extends ListFolding {
  readonly prefs: ListPrefsService;
  readonly tracks: LibraryTracksService;
  readonly stats: PlayStatsService;
  readonly menu: TrackMenuService;
  /** 列表形态的多选，按行序号；随服务存活，切回封面墙再切回来还在。 */
  readonly selection: RowSelection;
  /** 行序号换了一批（换排序、分节、过滤，曲目重取）：选中清空，行数跟上。同一批不动。 */
  syncOrders(orders: AlbumListOrders): void;
  /** 按播放统计排序、曲目到手、foo_playcount 在时取统计；曲目头一次到手时先探装没装。 */
  syncStats(): void;
  dispose(): void;
}

export function startAlbumList(
  store: Store,
  deps: AlbumListDeps,
  host: AlbumListFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): AlbumListServices {
  const prefs = startListPrefs(store, host, undefined, writer);
  const tracks = startLibraryTracks(store, deps.stamp, host);
  const stats = startPlayStats(store, host);
  const menu = startTrackMenu(store, host);
  const selection = createRowSelection(store, { total: 0 });
  let orders: AlbumListOrders | null = null;
  // 整库每一首，没有专辑名的也算：歌曲页与这里共用一份播放统计，按同一代次只取一遍。
  const allTracks = () => [...store.get(libraryTracksAtom).byHandle.values()];

  return {
    prefs,
    tracks,
    stats,
    menu,
    selection,
    ...createListFolding(store, () => store.get(albumListOrdersAtom), deps.updateCollapsed),
    syncOrders(next) {
      if (next === orders) return;
      orders = next;
      selection.clear();
      selection.setTotal(next.total);
    },
    syncStats() {
      const loaded = store.get(libraryTracksAtom);
      if (loaded.status !== 'ready') return;
      const { available } = store.get(playStatsAtom);
      if (available === null) void stats.probe();
      if (available && isStatsField(store.get(listPrefsAtom).sort.field)) {
        void stats.fetch(allTracks(), loaded.generation);
      }
    },
    dispose() {
      menu.dispose();
      stats.dispose();
      tracks.dispose();
      prefs.dispose();
    },
  };
}

export const albumListKey = serviceKey<AlbumListServices>('albumList');
