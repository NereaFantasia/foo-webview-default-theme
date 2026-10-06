import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useMemo, useState } from 'react';
import { createColumnsModel } from '../../../table/columns/columnsModel.ts';
import { widthOf } from '../../../table/columns/columns.ts';
import { createRowSelection } from '../../../table/rowSelection.ts';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { foldersPrefsAtom } from '../foldersPrefs.ts';
import { foldersPreviewAtom } from './foldersPreview.ts';
import {
  foldersConditionsAtom,
  foldersResultsAtom,
  foldersScopeTracksAtom,
} from './foldersResults.ts';
import { foldersItems, foldersStructure } from './foldersStructure.ts';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

const ROW_HEIGHTS = { compact: 32, standard: 40, comfortable: 56 };
export function useFoldersView(sort: TableSort | null) {
  const store = useStore();
  const folders = useService(foldersKey);
  const preview = useAtomValueRawSync(foldersPreviewAtom);
  const results = useAtomValueRawSync(foldersResultsAtom);
  const prefs = useAtomValueRawSync(foldersPrefsAtom);
  const conditions = useAtomValueRawSync(foldersConditionsAtom);
  const scopeTracks = useAtomValueRawSync(foldersScopeTracksAtom);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [columns] = useState(() =>
    createColumnsModel(store, {
      key: 'default-theme.preview-columns.tree.v1',
      offered: ['cover', 'status', 'number', 'title', 'artist', 'album', 'rating', 'duration'],
      hidden: ['status', 'album'],
      widths: { cover: 80 },
    }),
  );
  const [selection] = useState(() => createRowSelection(store, { total: 0 }));
  const layout = useAtomValueRawSync(columns.layout);
  const columnState = useAtomValueRawSync(columns.state);
  useEffect(() => {
    if (store.get(foldersPrefsAtom).coverColumnReady || columnState.containerWidth <= 520) return;
    // 旧目录表不提供封面列，首次启用时修复它留下的隐藏或零宽值，其余列配置保留。
    columns.setHidden('cover', false);
    const resize = columns.beginResize('cover', new Map());
    if (!resize) return;
    if (widthOf(columnState.widths, 'cover') === 0) resize.update(80);
    resize.commit();
    folders.prefs.change({ coverColumnReady: true });
  }, [columns, columnState, folders, store]);
  const rowHeight = ROW_HEIGHTS[prefs.density];
  const full = useMemo(
    () => foldersStructure(preview.nodes, scopeTracks, sort),
    [preview.nodes, scopeTracks, sort],
  );
  const structure = useMemo(
    () => foldersStructure(preview.nodes, results.tracks, sort),
    [preview.nodes, results.tracks, sort],
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
    playable: preview.status === 'ready' && results.status === 'ready' && results.tracks.length > 0,
  };
}
export type FoldersView = ReturnType<typeof useFoldersView>;
