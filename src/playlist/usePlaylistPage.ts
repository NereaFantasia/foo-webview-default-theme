import type { PlaylistInfo } from 'foo-webview-sdk';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ColumnMenuExtras } from '../table/columns/ColumnMenuExtras.tsx';
import type { ColumnId } from '../table/columns/columns.ts';
import { createColumnsModel, type ColumnsModel } from '../table/columns/columnsModel.ts';
import { intersectRanges, rangesOfRows, sameRanges } from '../table/rangeSelection.ts';
import { createRowSelection, type RowSelection } from '../table/rowSelection.ts';
import type { TableSort } from '../table/TrackTableHeader.tsx';
import { playlistColumnMenu } from './playlistColumnMenu.ts';
import type { PlaylistFilterState } from './filter/playlistFilter.ts';
import type { PlaylistGroupsState } from './groups/playlistGroups.ts';
import type { GroupsPrefs } from './groups/playlistGroupsPrefs.ts';
import type { PlaylistRowsState } from './playlistRowSource.ts';
import { playlistsAtom } from '../playback/playlists.ts';
import { buildPlaylistView, type PlaylistView } from './playlistView.ts';
import { COLUMN_SORT } from './sortPatterns.ts';
import { useService } from '../kit/useService.ts';
import { playlistRowsKey } from './playlistRows.ts';
import { playlistPageKey } from './playlistPageServices.ts';

/** 曲目行与空位的高、分组头的高，CSS 像素。 */
export const ROW_HEIGHT = 40;
export const GROUP_HEIGHT = 32;
/** 列存档的键，各张列表共用一份。 */
const COLUMNS_KEY = 'default-theme.playlist-columns.v5';
/** 这一页提供的列。表格内核后来加的几列要另取字段，行服务没取，不提供。 */
const PLAYLIST_COLUMNS: readonly ColumnId[] = [
  'cover',
  'status',
  'number',
  'title',
  'artist',
  'album',
  'rating',
  'duration',
];
/** 不分组时没有封面可画，封面列不提供。两份列模型共用同一份存档。 */
const FLAT_COLUMNS: readonly ColumnId[] = PLAYLIST_COLUMNS.filter((id) => id !== 'cover');

/** 列头的排序记号，连同发出排序时的内容版本与分组依据。 */
interface SortMark extends TableSort {
  readonly since: number;
  readonly mode: number;
}

export interface PlaylistPageModel {
  /** 清单里的这一张；清单还没读回、或已经删了时为 undefined。 */
  readonly entry: PlaylistInfo | undefined;
  readonly rows: PlaylistRowsState;
  readonly groups: PlaylistGroupsState;
  readonly filter: PlaylistFilterState;
  readonly prefs: GroupsPrefs;
  readonly view: PlaylistView;
  /** 最近一次提交的条目流与换算；在事件处理与定时器里读它，不读闭包里那一份。 */
  readonly latest: () => PlaylistView;
  readonly columns: ColumnsModel;
  /** 分组态的封面列宽，0 是封面列关着。 */
  readonly coverWidth: number;
  readonly selection: RowSelection;
  readonly columnMenu: ColumnMenuExtras;
  readonly sort: TableSort | null;
  onSort(column: ColumnId): void;
  /** 收起列头的排序记号：撤销、重做这类改了顺序、又不一定带来内容事件的命令之后调。 */
  resetSort(): void;
  /** 表格画出来的显示位区间：换成行号交给行服务取页。 */
  onRange(start: number, end: number): void;
}

/**
 * 播放列表页这一张列表的数据：挂上时向行、分组与过滤三个服务登记要看它，把三者此刻的样子排成条目流，
 * 本地选中交给选中同步。列头单击按那一列的排序串排宿主列表，宿主办成了才挪排序记号。
 */
export function usePlaylistPage(guid: string): PlaylistPageModel {
  const store = useStore();
  const rowsService = useService(playlistRowsKey);
  const page = useService(playlistPageKey);
  useEffect(() => rowsService.acquire(guid), [rowsService, guid]);
  useEffect(() => page.groups.acquire(guid), [page, guid]);
  useEffect(() => page.filter.acquire(guid), [page, guid]);
  const rows = useAtomValueRawSync(rowsService.stateOf(guid));
  const groups = useAtomValueRawSync(page.groups.stateOf(guid));
  const filter = useAtomValueRawSync(page.filter.stateOf(guid));
  const prefs = useAtomValueRawSync(page.groups.prefsAtom);
  const entry = useAtomValueRawSync(playlistsAtom).items.find((item) => item.guid === guid);

  const [models] = useState(() => ({
    grouped: createColumnsModel(store, { key: COLUMNS_KEY, offered: PLAYLIST_COLUMNS }),
    flat: createColumnsModel(store, { key: COLUMNS_KEY, offered: FLAT_COLUMNS }),
  }));
  const { coverWidth } = useAtomValueRawSync(models.grouped.layout);
  const countMinimum = coverWidth > 0 ? Math.ceil(coverWidth / ROW_HEIGHT) : 0;
  // 行服务的状态每到一页换一个对象，条目流跟着重排；取行本身读的是服务的缓存。
  const view = useMemo(
    () =>
      buildPlaylistView({
        total: rows.total,
        rowAt: (row) => rowsService.rowAt(guid, row),
        stampAt: (row) => rowsService.stampAt(guid, row),
        currentAt: (row) => rowsService.currentAt(guid, row),
        filter: filter.active ? { hits: filter.hits, stamp: filter.stamp } : null,
        grouping: prefs.enabled,
        runs: groups.runs,
        collapsed: groups.collapsed,
        groupsLoading: groups.loading,
        groupsFailed: groups.failure !== null,
        countMinimum,
      }),
    [rowsService, guid, rows, filter, prefs.enabled, groups, countMinimum],
  );
  const latestView = useRef(view);
  useLayoutEffect(() => {
    latestView.current = view;
  });
  const latest = useCallback(() => latestView.current, []);

  const [selection] = useState(() =>
    createRowSelection(store, { total: 0, reachable: () => latestView.current.reachable() }),
  );
  useEffect(() => page.selection.attach(guid, selection), [page, guid, selection]);
  // 过滤态看不见的行不留在选中里：进过滤前选着的、宿主后来报的，都收窄到命中的行，宿主那份跟着推过去。
  // 不然 Delete 与菜单会连屏幕外的曲目一起处理。分组折起来藏着的选中照旧算，那是扩选时用户自己带进去的。
  useEffect(() => {
    if (view.shape !== 'filtered') return;
    const narrow = () => {
      const { ranges } = store.get(selection.state);
      const kept = intersectRanges(ranges, view.reachable());
      if (!sameRanges(kept, ranges)) selection.replace(kept);
    };
    narrow();
    let closed = false;
    // 宿主报来的那份在选中同步「不推回去」的写入里落地，延到那一笔之后再收窄，收窄的结果才推得出去。
    const off = store.sub(selection.state, () =>
      queueMicrotask(() => {
        if (!closed) narrow();
      }),
    );
    return () => {
      closed = true;
      off();
    };
  }, [store, selection, view]);

  // 排序记号只说明「宿主按这一列排过，之后没再动过」：撤销、重做、别处改序、增删行与换分组依据（那也是一次
  // 重排）之后收起。排序自己带来的那一次内容变化不算，所以比发出时的内容版本多一版以内还算数。
  const [mark, setMark] = useState<SortMark | null>(null);
  const sort =
    mark && rows.contentVersion <= mark.since + 1 && prefs.mode === mark.mode ? mark : null;
  const onSort = (column: ColumnId) => {
    const pattern = COLUMN_SORT[column];
    if (!pattern) return;
    const descending = sort?.column === column && !sort.descending;
    const since = rows.contentVersion;
    const { mode } = prefs;
    void page.tracks.sort(guid, pattern, descending).then((ok) => {
      if (ok) setMark({ column, descending, since, mode });
    });
  };

  const onRange = useCallback(
    (start: number, end: number) => {
      const current = latestView.current;
      if (current.shape === 'filtered') return;
      const wanted: number[] = [];
      for (let at = start; at < end; at += 1) {
        const item = current.items[at];
        // 分组头读组内第一行，那一行也要取；折起的组之间隔着的行不取。
        const row =
          item?.kind === 'row' ? item.order : item?.kind === 'group' ? item.data.start : -1;
        if (row >= 0) wanted.push(row);
      }
      if (wanted.length > 0) rowsService.want(guid, rangesOfRows(wanted));
    },
    [rowsService, guid],
  );

  const columnMenu = playlistColumnMenu({
    guid,
    prefs,
    groupsState: groups,
    groups: page.groups,
    tracks: page.tracks,
    onSorted: () => setMark(null),
  });
  const grouped = view.shape === 'grouped' || view.shape === 'waiting';
  return {
    entry,
    rows,
    groups,
    filter,
    prefs,
    view,
    latest,
    columns: grouped ? models.grouped : models.flat,
    coverWidth: grouped ? coverWidth : 0,
    selection,
    columnMenu,
    sort,
    onSort,
    resetSort: () => setMark(null),
    onRange,
  };
}
