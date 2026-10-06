import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { historyAtom, type NavHistoryService } from '../../nav/navHistory.ts';
import type { Store } from '../../kit/store.ts';
import {
  startFoldersActions,
  type FoldersActionsDeps,
  type FoldersActionsFace,
  type FoldersActionsService,
} from './actions/foldersActions.ts';
import {
  startFoldersPreview,
  foldersPreviewAtom,
  type FoldersPreviewService,
} from './detail/foldersPreview.ts';
import { startFoldersFilter, type FoldersFilterService } from './tree/foldersFilter.ts';
import {
  foldersAddress,
  foldersSubject,
  foldersSubjects,
  foldersSelection,
  type FolderNode,
} from './tree/foldersModel.ts';
import { startFoldersPrefs, type FoldersPrefsService } from './foldersPrefs.ts';
import {
  startFoldersTrash,
  type FoldersTrashFace,
  type FoldersTrashService,
} from './actions/foldersTrash.ts';
import { startFoldersResults, type FoldersResultsService } from './detail/foldersResults.ts';
import { startFoldersCovers, type FoldersCoversService } from './detail/foldersCovers.ts';
import {
  startFoldersTree,
  foldersTreeAtom,
  type FoldersHost,
  type FoldersTreeService,
} from './tree/foldersTree.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

const focusAtom = atom<string | null>(null);
export const foldersFocusAtom: Atom<string | null> = atom((get) => get(focusAtom));
export interface FoldersDeps extends Omit<FoldersActionsDeps, 'roots'> {
  readonly history: Pick<NavHistoryService, 'registerSubject' | 'subjectsChanged' | 'navigate'>;
  stamp(): number;
}
export interface FoldersServices {
  readonly tree: FoldersTreeService;
  readonly preview: FoldersPreviewService;
  readonly filter: FoldersFilterService;
  readonly actions: FoldersActionsService;
  readonly prefs: FoldersPrefsService;
  readonly results: FoldersResultsService;
  readonly covers: FoldersCoversService;
  readonly trash: FoldersTrashService;
  want(): () => void;
  select(node: FolderNode, delay?: number): void;
  selectMany(nodes: readonly FolderNode[], delay?: number): void;
  open(subject: string, reveal?: boolean): Promise<boolean | null>;
  visit(subject: string): Promise<boolean | null>;
  dispose(): void;
}
export function startFolders(
  store: Store,
  deps: FoldersDeps,
  host: FoldersHost & FoldersActionsFace & FoldersTrashFace & Pick<typeof fb, 'artwork'> = fb,
): FoldersServices {
  store.set(focusAtom, null);
  const tree = startFoldersTree(store, host);
  const preview = startFoldersPreview(store, deps.stamp, host);
  const prefs = startFoldersPrefs(store);
  const results = startFoldersResults(store, host);
  const covers = startFoldersCovers(store, host);
  const trash = startFoldersTrash(store, host);
  const filter = startFoldersFilter(store, tree, host);
  const actions = startFoldersActions(
    store,
    {
      ...deps,
      roots: () => {
        const state = store.get(foldersTreeAtom);
        return state.roots.flatMap((key) => state.nodes.get(key) ?? []);
      },
    },
    host,
  );
  let disposed = false;
  let active = 0;
  let serial = 0;
  let generation = 0;
  let wasLoading = false;
  function select(node: FolderNode, delay = 0) {
    selectMany([node], delay);
  }
  function selectMany(nodes: readonly FolderNode[], delay = 0) {
    if (disposed || !active) return;
    const shown = store.get(foldersPreviewAtom);
    if (foldersSubjects(shown.nodes) === foldersSubjects(nodes) && shown.status !== 'failed')
      return;
    serial += 1;
    store.set(focusAtom, nodes.length ? foldersSubjects(nodes) : null);
    preview.selectMany(nodes, delay);
    deps.history.subjectsChanged();
  }
  async function open(subject: string, reveal = true) {
    const mine = ++serial;
    const nodes: FolderNode[] = [];
    for (const key of foldersSelection(subject)) {
      const found = await tree.locate(key);
      if (disposed || !active || mine !== serial) return null;
      if (!found) {
        store.set(focusAtom, null);
        preview.select(null);
        return false;
      }
      nodes.push(found);
    }
    const node = nodes[0];
    if (disposed || !active || mine !== serial) return null;
    if (!node) {
      store.set(focusAtom, null);
      preview.select(null);
      return false;
    }
    if (reveal) {
      const expanded = new Set(store.get(foldersTreeAtom).expanded);
      for (const selected of nodes) {
        let parent = selected.parent;
        while (parent) {
          expanded.add(parent);
          parent = store.get(foldersTreeAtom).nodes.get(parent)?.parent ?? null;
        }
      }
      await tree.restore(expanded);
    }
    if (disposed || !active || mine !== serial) return null;
    selectMany(nodes);
    return true;
  }
  const offSubject = deps.history.registerSubject('folders', {
    current: () => store.get(focusAtom),
    enter(subject) {
      serial += 1;
      store.set(focusAtom, subject);
      preview.select(null);
    },
    exists(subject) {
      const state = store.get(foldersTreeAtom);
      const keys = foldersSelection(subject);
      return (
        keys.length > 0 &&
        keys.every((key) => {
          const address = foldersAddress(key);
          return (
            !!address &&
            (state.status !== 'ready' ||
              state.roots.includes(foldersSubject({ ...address, pathId: '' })))
          );
        })
      );
    },
    replaceMissing: true,
  });
  const offTree = store.sub(foldersTreeAtom, () => {
    const state = store.get(foldersTreeAtom);
    if (state.status === 'loading' && !wasLoading) {
      wasLoading = true;
      preview.select(null);
      actions.cancel();
    }
    if (state.status !== 'ready' || generation === state.generation) return;
    wasLoading = false;
    generation = state.generation;
    const key = store.get(focusAtom);
    if (key && active) void open(key, false);
    deps.history.subjectsChanged();
  });
  return {
    tree,
    preview,
    filter,
    actions,
    prefs,
    results,
    covers,
    trash,
    select,
    selectMany,
    open,
    visit(subject) {
      if (disposed || !active) return Promise.resolve(null);
      // 离开快照必须先记录旧主体，随后再切换预览。
      const current = store.get(historyAtom).place;
      if (current.id !== 'folders' || current.subject !== undefined)
        deps.history.navigate({ id: 'folders', subject });
      store.set(focusAtom, subject);
      return open(subject);
    },
    want() {
      active += 1;
      const release = tree.want();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        if (active === 0) {
          serial += 1;
          filter.suspend();
          actions.cancel();
          preview.select(null);
        }
        release();
      };
    },
    dispose() {
      disposed = true;
      serial += 1;
      offTree();
      offSubject();
      actions.dispose();
      trash.dispose();
      results.dispose();
      covers.dispose();
      filter.dispose();
      preview.dispose();
      tree.dispose();
    },
  };
}

export const foldersKey = serviceKey<FoldersServices>('folders');
