import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useMemo, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { ColumnId } from '../../table/columns/columns.ts';
import { createColumnsModel, type ColumnsModel } from '../../table/columns/columnsModel.ts';
import { createRowSelection, type RowSelection } from '../../table/rowSelection.ts';
import type { TableLinks, TableRowItem, TableTrack } from '../../table/tableItems.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { albumsAtom } from '../albums.ts';
import { albumKeyOf, trackAlbumKeyOf, type Album } from '../../host/libraryContract.ts';
import { libraryTracksAtom, type LibraryTracksState } from '../libraryTracks.ts';
import { playStatsAtom } from '../playStats.ts';
import type { SongsRun } from './songsActions.ts';
import { songsFilterAtom, type SongsFilter, type SongsQuery } from './songsFilter.ts';
import { songsLabel } from './songsLabels.ts';
import { songsRowsAtom, type SongsRowsState } from './songsRows.ts';
import { songsFillAtom, songsQueryAtom, songsKey } from './songsServices.ts';
import { songsPrefsAtom, type SongsDensity } from './songsPrefs.ts';
import { SONGS_SORT } from './songsSort.ts';
import { buildSongsView, type SongsView } from './songsView.ts';
import { useService } from '../../kit/useService.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';

/** 各档疏密的行高，CSS 像素；标准档与别的曲目表一样高，缩略图边长由表格按行高算。 */
const ROW_HEIGHTS: Readonly<Record<SongsDensity, number>> = {
  compact: 32,
  standard: 40,
  comfortable: 56,
};
const COLUMNS_KEY = 'default-theme.songs-columns.v1';
/** 这一页提供的列。不分组，没有跨组的封面列；每一首的封面画在缩略图列里。 */
const SONGS_COLUMNS: readonly ColumnId[] = [
  'status',
  'number',
  'art',
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'genre',
  'added',
  'playCount',
  'lastPlayed',
  'codec',
  'bitrate',
  'path',
  'rating',
  'duration',
];
/** 缺省只显示缩略图、标题、艺术家、专辑、年份、流派、等级与时长，其余可在列头菜单里勾。 */
const HIDDEN: readonly ColumnId[] = [
  'number',
  'albumArtist',
  'added',
  'playCount',
  'lastPlayed',
  'codec',
  'bitrate',
  'path',
];
/** 表格不足这么宽（窗口 900 一档）时先收起年份与流派。 */
const COMPACT = { width: 860, columns: ['year', 'genre'] } as const;
/** 这几列要 foo_playcount 的统计，显示时才取。 */
const STATS_COLUMNS: ReadonlySet<ColumnId> = new Set(['added', 'playCount', 'lastPlayed']);
/** 第一次读整库、顺序还没回来时画这么多行骨架。 */
const SKELETON: readonly TableRowItem[] = Array.from({ length: 12 }, (_, order) => ({
  kind: 'row',
  key: `skeleton-${order}`,
  order,
  track: undefined,
}));

export interface SongsPageModel {
  readonly rows: SongsRowsState;
  readonly library: LibraryTracksState;
  readonly filter: SongsFilter;
  readonly query: SongsQuery;
  readonly view: SongsView;
  /** 交给表格的条目流：顺序还没回来时是骨架。 */
  readonly items: readonly TableRowItem[];
  readonly columns: ColumnsModel;
  readonly selection: RowSelection;
  readonly sort: TableSort;
  onSort(column: ColumnId): void;
  readonly links: TableLinks;
  /** 这一首折进的那张专辑；不属于哪张、或专辑清单里还没有它时是 undefined。专辑清单换一份才换一个函数。 */
  readonly albumOf: (track: TableTrack) => Album | undefined;
  /** 按疏密偏好的行高，CSS 像素。 */
  readonly rowHeight: number;
  /** 起播与成批命令要的那一份：表格此刻显示的查询、排序，与条件的说明。 */
  readonly run: SongsRun;
  /** 还在读：第一次读整库或顺序，或者重取途中。 */
  readonly loading: boolean;
  /** 顺序与整库曲目都到过一次了，空表才说得上「没有」。 */
  readonly settled: boolean;
  /** 当前筛选与排序已取得有效结果，允许页头的整批操作。 */
  readonly resultsCurrent: boolean;
}

/**
 * 歌曲页的数据：挂上时要整库曲目与歌曲页的顺序，按宿主排好的 handle 取行；显示添加时间、播放次数或最近播放时
 * 才取播放统计。顺序换了一批就清空多选。
 */
export function useSongsPage(): SongsPageModel {
  const store = useStore();
  const songs = useService(songsKey);
  const albumList = useService(albumListKey);
  const albumDetail = useService(albumDetailKey);
  const t = useAtomValueRawSync(translateAtom);
  useEffect(() => albumList.tracks.want(), [albumList]);
  useEffect(() => songs.rows.acquire(), [songs]);
  const rows = useAtomValueRawSync(songsRowsAtom);
  const library = useAtomValueRawSync(libraryTracksAtom);
  const stats = useAtomValueRawSync(playStatsAtom);
  const { sort, density } = useAtomValueRawSync(songsPrefsAtom);
  const filter = useAtomValueRawSync(songsFilterAtom);
  const query = useAtomValueRawSync(songsQueryAtom);
  const fill = useAtomValueRawSync(songsFillAtom);
  const { albums } = useAtomValueRawSync(albumsAtom);

  const [columns] = useState(() =>
    createColumnsModel(store, {
      key: COLUMNS_KEY,
      offered: SONGS_COLUMNS,
      hidden: HIDDEN,
      compact: COMPACT,
    }),
  );
  const { cells } = useAtomValueRawSync(columns.layout);
  const statsShown = cells.some((id) => STATS_COLUMNS.has(id));
  useEffect(() => {
    if (library.status !== 'ready') return;
    const all = [...library.byHandle.values()];
    void albumList.stats.probe();
    if (statsShown && stats.available) void albumList.stats.fetch(all, library.generation);
  }, [albumList, library, statsShown, stats.available]);

  const view = useMemo(
    () => buildSongsView(rows.handles, library.byHandle, statsShown ? stats.byHandle : null),
    [rows.handles, library.byHandle, statsShown, stats.byHandle],
  );
  const settled = rows.answered !== null && library.generation > 0;
  const failed = rows.status === 'failed' || library.status === 'failed';
  const firstRead =
    !failed && !rows.invalid && (rows.answered === null || library.generation === 0);
  const displayed = rows.answered ?? fill;
  const label =
    displayed.query === fill.query
      ? songsLabel(filter, t)
      : displayed.query === 'ALL'
        ? ''
        : displayed.query;

  const [selection] = useState(() => createRowSelection(store, { total: 0 }));
  useEffect(() => {
    selection.clear();
    selection.setTotal(rows.handles.length);
  }, [selection, rows.generation, rows.handles.length]);

  // 表格交回的行只有 `TableTrack` 的字段，折专辑键要的多值艺术家按 handle 从整库曲目里取。
  const albumOf = useMemo(() => {
    const index = new Map(albums.map((album) => [albumKeyOf(album), album]));
    return (track: TableTrack): Album | undefined => {
      const full = library.byHandle.get(track.handle);
      const key = full ? trackAlbumKeyOf(full) : null;
      return key ? index.get(key) : undefined;
    };
  }, [albums, library.byHandle]);
  const links = useMemo<TableLinks>(
    () => ({
      album: (track) => {
        const album = albumOf(track);
        if (album) albumDetail.open(album);
      },
    }),
    [albumOf, albumDetail],
  );

  return {
    rows,
    library,
    filter,
    query,
    view,
    items: firstRead ? SKELETON : view.items,
    columns,
    selection,
    sort,
    onSort: (column) => {
      if (SONGS_SORT[column] !== undefined) songs.prefs.sortBy(column);
    },
    links,
    albumOf,
    rowHeight: ROW_HEIGHTS[density],
    // 起播与成批命令按表格此刻显示的那一份：打字的去抖还没过、或框里的查询有误时，表格还是上一次的结果。
    run: { fill: displayed, label },
    loading: firstRead || rows.status === 'loading' || library.status === 'loading',
    settled,
    resultsCurrent:
      settled &&
      !rows.invalid &&
      rows.status === 'ready' &&
      library.status === 'ready' &&
      rows.answered?.query === fill.query &&
      rows.answered.sort === fill.sort &&
      rows.answered.descending === fill.descending,
  };
}
