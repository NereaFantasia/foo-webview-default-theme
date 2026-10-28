import { COLUMN_PREFS } from '../../../table/columns/columnMigration.ts';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useMemo, useState } from 'react';
import { createColumnsModel } from '../../../table/columns/columnsModel.ts';
import { EXTENDED_COLUMNS, EXTENDED_INTRODUCED, widthOf } from '../../../table/columns/columns.ts';
import { createRowSelection } from '../../../table/rowSelection.ts';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { foldersPrefsAtom } from '../foldersPrefs.ts';
import { foldersPreviewAtom } from './foldersPreview.ts';
import {
  foldersConditionsAtom,
  foldersMediaAtom,
  foldersResultsAtom,
  foldersScopeTracksAtom,
} from './foldersResults.ts';
import { foldersItems, foldersStructure } from './foldersStructure.ts';
import { useService } from '../../../kit/useService.ts';
import { TRACK_STATS_COLUMNS } from '../../../track/trackSort.ts';
import { useTrackStats } from '../../useTrackStats.ts';
import { foldersKey } from '../foldersServices.ts';

const ROW_HEIGHTS = { compact: 32, standard: 40, comfortable: 56 };
export function useFoldersView(sort: TableSort | null) {
  const store = useStore();
  const folders = useService(foldersKey);
  const preview = useAtomValueRawSync(foldersPreviewAtom);
  const results = useAtomValueRawSync(foldersResultsAtom);
  const prefs = useAtomValueRawSync(foldersPrefsAtom);
  const conditions = useAtomValueRawSync(foldersConditionsAtom);
  const media = useAtomValueRawSync(foldersMediaAtom);
  const scopeTracks = useAtomValueRawSync(foldersScopeTracksAtom);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // 封面列的位置留给目录组头画封面；平铺时没有组头，换成每行一张的缩略图列。封面视图仍按目录出卡片
  const grouped = prefs.grouped || prefs.view === 'covers';
  const columns = useMemo(
    () =>
      createColumnsModel(store, {
        ...COLUMN_PREFS.folders,
        offered: [
          grouped ? 'cover' : 'art',
          'status',
          'number',
          'title',
          'artist',
          'album',
          'rating',
          'duration',
          ...EXTENDED_COLUMNS,
        ],
        hidden: ['status', 'album', ...EXTENDED_COLUMNS],
        widths: { cover: 80 },
        introduced: EXTENDED_INTRODUCED,
      }),
    [store, grouped],
  );
  const [selection] = useState(() => createRowSelection(store, { total: 0 }));
  const layout = useAtomValueRawSync(columns.layout);
  const columnState = useAtomValueRawSync(columns.state);
  useEffect(() => {
    if (store.get(foldersPrefsAtom).coverColumnReady || columnState.containerWidth <= 520) return;
    // 旧目录表不提供封面列，首次启用时修复它留下的隐藏或零宽值，其余列配置保留
    columns.setHidden('cover', false);
    const resize = columns.beginResize('cover', new Map());
    if (!resize) return;
    if (widthOf(columnState.widths, 'cover') === 0) resize.update(80);
    resize.commit();
    folders.prefs.change({ coverColumnReady: true });
  }, [columns, columnState, folders, store]);
  // 统计列显示时、或按统计排序时才取统计；排序在前端做，要先并进曲目
  const stats = useTrackStats(
    results.tracks,
    layout.cells.some((id) => TRACK_STATS_COLUMNS.has(id)) ||
      (sort !== null && TRACK_STATS_COLUMNS.has(sort.column)),
  );
  const rowHeight = ROW_HEIGHTS[prefs.density];
  const full = useMemo(
    () => foldersStructure(preview.nodes, scopeTracks, sort),
    [preview.nodes, scopeTracks, sort],
  );
  const structure = useMemo(
    () => foldersStructure(preview.nodes, stats.tracks, sort, grouped),
    [preview.nodes, stats.tracks, sort, grouped],
  );
  const cards =
    structure.groups.length === 1 ? (structure.groups[0]?.children ?? []) : structure.groups;
  const covers = prefs.view === 'covers' && cards.length > 0;
  const coverWidth = layout.coverWidth;
  const items = useMemo(
    () => foldersItems(structure, collapsed, coverWidth, rowHeight, covers),
    [structure, collapsed, coverWidth, rowHeight, covers],
  );
  useEffect(() => {
    selection.clear();
    selection.setTotal(structure.tracks.length);
  }, [selection, structure.tracks]);
  function toggle(key: string) {
    setCollapsed((before) => {
      const next = new Set(before);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  return {
    preview,
    results,
    prefs,
    conditions,
    media,
    scopeTracks,
    columns,
    selection,
    rowHeight,
    full,
    structure,
    items,
    cards,
    covers,
    coverWidth,
    collapsed,
    setCollapsed,
    toggle,
    statsFailed: stats.failed,
    retryStats: stats.retry,
    playable: preview.status === 'ready' && results.status === 'ready' && results.tracks.length > 0,
  };
}
export type FoldersView = ReturnType<typeof useFoldersView>;
