import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { albumKeyOf, trackAlbumKeyOf, type Album } from '../../../host/libraryContract.ts';
import { choiceCodec, defineLocalPref } from '../../../kit/localPref.ts';
import { useService } from '../../../kit/useService.ts';
import { EXTENDED_COLUMNS, type ColumnId } from '../../../table/columns/columns.ts';
import { createColumnsModel, type ColumnsModel } from '../../../table/columns/columnsModel.ts';
import { rowsOf, sameRanges } from '../../../table/rangeSelection.ts';
import { createRowSelection, type RowSelection } from '../../../table/rowSelection.ts';
import type { TablePoint, TableRowItem, TableTrack } from '../../../table/tableItems.ts';
import type { TableMenuTarget } from '../../../table/useTrackTableInput.ts';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { trackFacetOptions, type TrackFacetOptions } from '../../../track/trackFacets.ts';
import type { TrackFilter } from '../../../track/trackFilter.ts';
import { TRACK_SORT, TRACK_STATS_COLUMNS } from '../../../track/trackSort.ts';
import { albumListKey } from '../../album-list/albumList.ts';
import { albumsAtom } from '../../albums.ts';
import { libraryTracksAtom, type LibraryTracksState } from '../../libraryTracks.ts';
import { playStatsAtom } from '../../playStats.ts';
import { SONGS_DENSITIES, type SongsDensity } from '../../songs/songsPrefs.ts';
import type { SongsRowsState } from '../../songs/songsRows.ts';
import { buildSongsView, type SongsView } from '../../songs/songsView.ts';
import { useGenreValues } from '../../useGenreValues.ts';
import { useTrackStatsStatus, type TrackStatsStatus } from '../../useTrackStats.ts';
import { cycleSearchSort, type SearchTracksService } from './searchTracks.ts';

/** 歌曲表格各密度档位的行高（单位 px），保持与歌曲视图一致 */
const ROW_HEIGHTS: Readonly<Record<SongsDensity, number>> = {
  compact: 32,
  standard: 40,
  comfortable: 56,
};
/** 检索曲目表格候选列定义，对齐歌曲视图 */
const OFFERED: readonly ColumnId[] = [
  'status',
  'number',
  'art',
  'title',
  'artist',
  'album',
  ...EXTENDED_COLUMNS,
  'rating',
  'duration',
];
/** 缺省隐藏的列定义，默认仅展示封面、标题、艺人、专辑与时长 */
const HIDDEN: readonly ColumnId[] = ['number', 'rating', ...EXTENDED_COLUMNS];
const COLUMNS_KEY = 'default-theme.search-columns.v1';
const densityPref = defineLocalPref<SongsDensity>({
  key: 'default-theme.search-density.v1',
  fallback: 'standard',
  ...choiceCodec(SONGS_DENSITIES),
});

export interface SearchTracksModel {
  readonly service: SearchTracksService;
  readonly rows: SongsRowsState;
  readonly matches: SongsRowsState;
  readonly library: LibraryTracksState;
  readonly filter: TrackFilter;
  readonly view: SongsView;
  readonly items: readonly TableRowItem[];
  readonly columns: ColumnsModel;
  readonly selection: RowSelection;
  /** 表格当前排序状态；为 null 时表示按相关度排序 */
  readonly sort: TableSort | null;
  /** 列头排序点击处理：新列按默认方向排序，同列二次点击反向，三次点击重置回相关度 */
  onSort(column: ColumnId): void;
  readonly albumOf: (track: TableTrack) => Album | undefined;
  readonly density: SongsDensity;
  setDensity(density: SongsDensity): void;
  readonly rowHeight: number;
  /** 分面统计选项；基于当前检索词的全部命中结果计算，不受后续过滤条件影响 */
  readonly facets: TrackFacetOptions;
  readonly loading: boolean;
  /** 数据完全就绪标记；检索结果句柄与整库曲目索引均已完成首次加载 */
  readonly settled: boolean;
  readonly stats: TrackStatsStatus;
  /** 曲目上下文菜单控制对象，供行右键与批量选区操作栏共用 */
  readonly menu: {
    readonly at: TablePoint | null;
    open(target: TableMenuTarget, at: TablePoint): void;
    close(): void;
    /** 校验当前操作曲目快照的时效性；若菜单打开后选区或数据代次发生变更则判定失效 */
    isCurrent(): boolean;
  };
}

/** 装配检索曲目表格交互模型；非激活状态下暂停拉取宿主命中句柄与整库曲目索引 */
export function useSearchTracks(service: SearchTracksService, active: boolean): SearchTracksModel {
  const store = useStore();
  const albumList = useService(albumListKey);
  useEffect(() => (active ? albumList.tracks.want() : undefined), [albumList, active]);
  useEffect(() => (active ? service.acquire() : undefined), [service, active]);
  const rows = useAtomValueRawSync(service.rows);
  const matches = useAtomValueRawSync(service.matches);
  const filter = useAtomValueRawSync(service.filter.state);
  const sort = useAtomValueRawSync(service.sort);
  const library = useAtomValueRawSync(libraryTracksAtom);
  const stats = useAtomValueRawSync(playStatsAtom);
  const { albums } = useAtomValueRawSync(albumsAtom);
  const [density, setDensity] = useState(() => densityPref.read());
  const [columns] = useState(() =>
    createColumnsModel(store, { key: COLUMNS_KEY, offered: OFFERED, hidden: HIDDEN }),
  );
  const { cells } = useAtomValueRawSync(columns.layout);
  const statsShown = active && cells.some((id) => TRACK_STATS_COLUMNS.has(id));
  useEffect(() => {
    if (library.status !== 'ready') return;
    void albumList.stats.probe();
    if (statsShown && stats.available)
      void albumList.stats.fetch([...library.byHandle.values()], library.generation);
  }, [albumList, library, statsShown, stats.available]);
  const statsStatus = useTrackStatsStatus(statsShown && library.status !== 'failed');

  const view = useMemo(
    () => buildSongsView(rows.handles, library.byHandle, statsShown ? stats.byHandle : null),
    [rows.handles, library.byHandle, statsShown, stats.byHandle],
  );
  const valuesOf = useGenreValues(active);
  const facets = useMemo(() => {
    const hits = matches.handles.flatMap((handle): LibraryTrack[] => {
      const track = library.byHandle.get(handle);
      return track ? [track] : [];
    });
    return trackFacetOptions(hits, valuesOf ?? undefined);
  }, [matches.handles, library.byHandle, valuesOf]);
  // 真实流派值加载完成前暂不修剪勾选项，避免因初始显示串不完整误剔已选分面
  useEffect(() => {
    if (library.status === 'ready' && matches.answered && valuesOf)
      service.filter.pruneFacets(facets);
  }, [service, facets, library.status, matches.answered, valuesOf]);

  const [selection] = useState(() => createRowSelection(store, { total: 0 }));
  useEffect(() => {
    selection.clear();
    selection.setTotal(rows.handles.length);
  }, [selection, rows.generation, rows.handles.length]);

  const albumOf = useMemo(() => {
    const index = new Map(albums.map((album) => [albumKeyOf(album), album]));
    return (track: TableTrack): Album | undefined => {
      const full = library.byHandle.get(track.handle);
      const key = full ? trackAlbumKeyOf(full) : null;
      return key ? index.get(key) : undefined;
    };
  }, [albums, library.byHandle]);

  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const menuCurrent = useRef<() => boolean>(() => false);

  const settled = rows.answered !== null && library.generation > 0;
  return {
    service,
    rows,
    matches,
    library,
    filter,
    view,
    items: view.items,
    columns,
    selection,
    sort,
    onSort(column) {
      if (TRACK_SORT[column] !== undefined) service.setSort(cycleSearchSort(sort, column));
    },
    albumOf,
    density,
    setDensity(next) {
      setDensity(next);
      densityPref.write(next);
    },
    rowHeight: ROW_HEIGHTS[density],
    facets,
    loading: !settled || rows.status === 'loading' || library.status === 'loading',
    settled,
    stats: statsStatus,
    menu: {
      at: menuAt,
      open(target, at) {
        if (target.kind !== 'rows') return;
        const tracks = rowsOf(target.rows).flatMap((row) => view.trackAt(row) ?? []);
        if (tracks.length === 0) return;
        const chosen = target.rows;
        const generation = rows.generation;
        menuCurrent.current = () =>
          sameRanges(chosen, store.get(selection.state).ranges) &&
          store.get(service.rows).generation === generation;
        void albumList.menu.prepare(tracks, view.trackAt(target.index), library.stamp);
        setMenuAt(at);
      },
      close: () => setMenuAt(null),
      isCurrent: () => menuCurrent.current(),
    },
  };
}
