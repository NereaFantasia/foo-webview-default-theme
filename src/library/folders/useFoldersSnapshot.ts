import { useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { PageEntryContext, usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import type { TrackTableHandle } from '../../table/TrackTable.tsx';
import { foldersFocusAtom, foldersKey } from './foldersServices.ts';
import { foldersFilterAtom } from './tree/foldersFilter.ts';
import { foldersTreeAtom } from './tree/foldersTree.ts';
import { foldersPreviewAtom } from './detail/foldersPreview.ts';
import type { FoldersTreeHandle } from './tree/FoldersTree.tsx';
import type { FoldersView } from './detail/useFoldersView.ts';
import { foldersSubjects } from './tree/foldersModel.ts';
import { songsQueryOf, type SongsFilter } from '../songs/songsFilter.ts';
import type { QueryScope } from '../../track/trackQuery.ts';
import { useService } from '../../kit/useService.ts';

interface FoldersSnapshot {
  readonly expanded: ReadonlySet<string>;
  readonly text: string;
  readonly focus: string | null;
  readonly treeFocus: string | null;
  readonly treeTop: number;
  readonly contentTop: number;
  readonly track: string | null;
  readonly sort: TableSort | null;
  readonly conditions: SongsFilter;
  readonly collapsed: ReadonlySet<string>;
  readonly scope: QueryScope;
  readonly recursive: boolean;
}
const SLOT = createSnapshotSlot<FoldersSnapshot>();
export function useFoldersSnapshot(
  tree: RefObject<HTMLDivElement | null>,
  treeHandle: RefObject<FoldersTreeHandle | null>,
  table: RefObject<TrackTableHandle | null>,
  content: RefObject<HTMLDivElement | null>,
  sort: TableSort | null,
  setSort: (sort: TableSort | null) => void,
  active: boolean,
  model: FoldersView,
) {
  const folders = useService(foldersKey);
  const entry = useContext(PageEntryContext);
  const catalog = useAtomValueRawSync(foldersTreeAtom);
  const filter = useAtomValueRawSync(foldersFilterAtom);
  const preview = useAtomValueRawSync(foldersPreviewAtom);
  const focus = useAtomValueRawSync(foldersFocusAtom);
  const pending = useRef<FoldersSnapshot | null>(null);
  const restoring = useRef(false);
  useLayoutEffect(() => {
    pending.current = null;
    restoring.current = false;
  }, [entry]);
  usePageSnapshot(
    SLOT,
    {
      capture: () =>
        pending.current ?? {
          expanded: catalog.expanded,
          text: filter.text,
          focus,
          treeFocus: treeHandle.current?.focusedKey() ?? null,
          sort,
          conditions: model.conditions,
          collapsed: model.collapsed,
          scope: model.prefs.scope,
          recursive: model.prefs.recursive,
          treeTop: tree.current?.scrollTop ?? 0,
          contentTop: content.current?.scrollTop ?? 0,
          track: table.current?.focusedKey() ?? null,
        },
      restore(saved) {
        pending.current = saved;
        setSort(saved.sort);
        model.setCollapsed(saved.collapsed);
      },
    },
    active,
  );
  useLayoutEffect(() => {
    const saved = pending.current;
    if (!active || !saved || catalog.status !== 'ready' || restoring.current) return;
    restoring.current = true;
    let disposed = false;
    void folders.tree.restore(saved.expanded).then(async () => {
      if (disposed) return;
      if (saved.focus) {
        const found = await folders.open(saved.focus, false);
        if (found === false)
          pending.current = { ...saved, focus: null, treeFocus: null, track: null, contentTop: 0 };
      }
      if (disposed) return;
      folders.filter.setText(saved.text);
      folders.prefs.change({ scope: saved.scope, recursive: saved.recursive });
      folders.results.restore(saved.conditions);
      restoring.current = false;
    });
    return () => {
      disposed = true;
      restoring.current = false;
    };
  }, [catalog.generation, catalog.status, folders, active, entry]);
  useLayoutEffect(() => {
    const saved = pending.current;
    if (
      !active ||
      !saved ||
      restoring.current ||
      catalog.status !== 'ready' ||
      filter.status === 'loading' ||
      filter.text !== saved.text
    )
      return;
    if (
      saved.focus &&
      (foldersSubjects(preview.nodes) !== saved.focus || preview.status === 'loading')
    )
      return;
    if (
      preview.status === 'ready' &&
      (model.results.status === 'loading' ||
        (model.results.status === 'ready' &&
          model.results.answered !== songsQueryOf(saved.conditions, saved.scope).query))
    )
      return;
    if (tree.current) tree.current.scrollTop = saved.treeTop;
    if (content.current) content.current.scrollTop = saved.contentTop;
    table.current?.setFocusKey(saved.track);
    treeHandle.current?.setFocusKey(saved.treeFocus);
    pending.current = null;
  }, [catalog, filter, preview, tree, treeHandle, table, content, active, model.results, entry]);
  return entry !== null && SLOT.values.has(entry);
}
