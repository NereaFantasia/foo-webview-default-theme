import type { ConfigWriter } from '../../host/configWrite.ts';
import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigPrefFace } from '../../host/configPref.ts';
import type { Store } from '../../kit/store.ts';
import { createRowSelection, type RowSelection } from '../../table/rowSelection.ts';
import { albumBrowseAtom } from '../albums/albumBrowse.ts';
import { buildListOrders, sortListTracks, type AlbumListOrders } from './albumListModel.ts';
import type { CollapsedSections } from '../albums/collapsedSections.ts';
import { albumKeyOf, trackPathOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';
import { PLAY_LIMIT } from '../../playback/libraryView.ts';
import { LIBRARY_SOURCE } from '../../playback/playbackSource.ts';
import type { TrackActionsService } from '../../track/trackActions.ts';
import type { AlbumForm } from '../albums/browserPrefs.ts';
import { shuffledSample } from '../libraryQueryFill.ts';
import {
  libraryTracksAtom,
  startLibraryTracks,
  type LibraryTracksFace,
  type LibraryTracksService,
} from '../libraryTracks.ts';
import { createListFolding, type ListFolding } from './listFolding.ts';
import {
  listPrefsAtom,
  listTrackSortAtom,
  startListPrefs,
  type ListPrefsService,
} from './listPrefs.ts';
import { sortFlatTracks, TRACK_STATS_COLUMNS } from '../../track/trackSort.ts';
import { isStatsField, orderSections, sortListAlbums } from './listSort.ts';
import {
  playStatsAtom,
  startPlayStats,
  withStats,
  type PlayStatsFace,
  type PlayStatsService,
} from '../playStats.ts';
import { startTrackMenu, type TrackMenuFace, type TrackMenuService } from '../trackMenu.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

/**
 * 浏览结果先按专辑排序与节序排定，再按列头排序各专辑内曲目。只有排序依赖播放统计时才因统计到达重排
 */
export const albumListOrdersAtom: Atom<AlbumListOrders> = atom((get) => {
  const { sections, headers } = get(albumBrowseAtom);
  const { sort, seed, sectionOrder, sectionDescending, albumGroups } = get(listPrefsAtom);
  const trackSort = get(listTrackSortAtom);
  const { byAlbum, generation } = get(libraryTracksAtom);
  const wantsStats = isStatsField(sort.field) || TRACK_STATS_COLUMNS.has(trackSort.column);
  const statsState = wantsStats ? get(playStatsAtom) : null;
  const stats = statsState?.generation === generation ? statsState.byHandle : null;
  const context = {
    tracksOf: (album: Album) => byAlbum.get(albumKeyOf(album)),
    statsOf: (track: LibraryTrack) => stats?.get(track.handle),
    seed,
  };
  const sorted = sections.map((section) => ({
    key: section.key,
    albums: sortListAlbums(section.albums, sort, context),
  }));
  return buildListOrders(
    orderSections(sorted, sectionOrder, sectionDescending),
    headers,
    (album) => {
      const tracks = context.tracksOf(album);
      return stats && TRACK_STATS_COLUMNS.has(trackSort.column)
        ? tracks?.map((track) => withStats(track, stats.get(track.handle)))
        : tracks;
    },
    trackSort,
    !albumGroups,
  );
});

const statsColumnsAtom = atom(false);
/** 列表形态要不要播放统计：按统计排序，或者显示着统计列 */
export const listStatsShownAtom: Atom<boolean> = atom(
  (get) =>
    isStatsField(get(listPrefsAtom).sort.field) ||
    TRACK_STATS_COLUMNS.has(get(listTrackSortAtom).column) ||
    get(statsColumnsAtom),
);

export interface AlbumListDeps {
  /** 评分服务的戳，取曲目前拿一个 */
  readonly stamp: () => number;
  /** 改折叠存档的整份，见 `AlbumBrowseService.updateCollapsed` */
  readonly updateCollapsed: (change: (value: CollapsedSections) => CollapsedSections) => void;
  /** 整页起播走页面共用的起播，失败与忙碌的提示挂在那里 */
  readonly play: Pick<TrackActionsService, 'playLoaded'>;
}

export type AlbumListFace = LibraryTracksFace & PlayStatsFace & TrackMenuFace & ConfigPrefFace;

export interface AlbumListServices extends ListFolding {
  readonly prefs: ListPrefsService;
  readonly tracks: LibraryTracksService;
  readonly stats: PlayStatsService;
  readonly menu: TrackMenuService;
  /** 列表形态的多选，按行序号；随服务存活，切回封面墙再切回来还在 */
  readonly selection: RowSelection;
  /** 行序号换了一批（换排序、分节、过滤，曲目重取）：选中清空，行数跟上。同一批不动 */
  syncOrders(orders: AlbumListOrders): void;
  /** 按播放统计排序或显示统计列、曲目到手、foo_playcount 在时取统计；曲目头一次到手时先探装没装 */
  syncStats(): void;
  /** 列表的表格显示着统计列与否，由表格按自己的列存档报上来 */
  setStatsColumns(shown: boolean): void;
  /**
   * 页头的播放全部：按此刻显示的专辑次序（这一形态的分节与排序，折叠着的节也算）把各张曲目连成一份起播；
   * 打乱时打乱的是这一份。整库曲目没取过就先取，取不到不播。超过 `PLAY_LIMIT` 首时只交前面那一截，
   * 打乱时随机取这么多首
   */
  playAll(form: AlbumForm, shuffle: boolean): Promise<boolean>;
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
  store.set(statsColumnsAtom, false);
  let orders: AlbumListOrders | null = null;
  // 整库每一首，没有专辑名的也算：歌曲页与这里共用一份播放统计，按同一代次只取一遍
  const allTracks = () => [...store.get(libraryTracksAtom).byHandle.values()];
  /** 此刻显示的专辑，按显示次序；艺术家档里在几节重复的专辑只算第一次 */
  function shownAlbums(form: AlbumForm): Album[] {
    const seen = new Set<AlbumKey>();
    const albums: Album[] = [];
    const add = (album: Album) => {
      const key = albumKeyOf(album);
      if (seen.has(key)) return;
      seen.add(key);
      albums.push(album);
    };
    if (form === 'list')
      for (const section of store.get(albumListOrdersAtom).sections)
        for (const entry of section.albums) add(entry.album);
    else
      for (const section of store.get(albumBrowseAtom).sections)
        for (const album of section.albums) add(album);
    return albums;
  }

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
      if (available && store.get(listStatsShownAtom)) {
        void stats.fetch(allTracks(), loaded.generation);
      }
    },
    setStatsColumns(shown) {
      if (store.get(statsColumnsAtom) !== shown) store.set(statsColumnsAtom, shown);
    },
    playAll(form, shuffle) {
      const albums = shownAlbums(form);
      const trackSort = form === 'list' ? store.get(listTrackSortAtom) : undefined;
      // 不按专辑分组时连成的次序是每节整体排过的，节里的专辑只提供归属
      const flatSections =
        form === 'list' && !store.get(listPrefsAtom).albumGroups
          ? store.get(albumListOrdersAtom).sections.map((section) => section.albums)
          : null;
      return deps.play.playLoaded(
        async () => {
          const loaded = await tracks.read();
          if (!loaded) return null;
          const statsState = store.get(playStatsAtom);
          const stats =
            trackSort &&
            TRACK_STATS_COLUMNS.has(trackSort.column) &&
            statsState.generation === loaded.generation
              ? statsState.byHandle
              : null;
          const rowsOf = (album: Album) => {
            const own = loaded.byAlbum.get(albumKeyOf(album)) ?? [];
            return stats ? own.map((track) => withStats(track, stats.get(track.handle))) : own;
          };
          const seen = new Set<string>();
          const all = flatSections
            ? flatSections
                .flatMap((entries) =>
                  sortFlatTracks(
                    entries.flatMap((entry) => rowsOf(entry.album)),
                    trackSort ?? null,
                  ),
                )
                .filter((track) => !seen.has(track.handle) && !!seen.add(track.handle))
            : albums.flatMap((album) => sortListTracks(rowsOf(album), trackSort));
          if (all.length === 0) return null;
          return (shuffle ? shuffledSample(all) : all.slice(0, PLAY_LIMIT)).map(trackPathOf);
        },
        0,
        LIBRARY_SOURCE,
      );
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
