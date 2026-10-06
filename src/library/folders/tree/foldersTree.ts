import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../../host/waitForHost.ts';
import type { Store } from '../../../kit/store.ts';
import {
  onLibraryChanged,
  LIBRARY_COALESCE_MS,
  type LibraryEventsFace,
} from '../../../host/libraryContract.ts';
import { createFoldersCache, type FoldersTreeFace } from './foldersCache.ts';
import { foldersRoot, type FolderNode } from './foldersModel.ts';

export interface FoldersTreeState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly enabled: boolean;
  readonly skipped: number;
  readonly generation: number;
  readonly roots: readonly string[];
  readonly nodes: ReadonlyMap<string, FolderNode>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly expanded: ReadonlySet<string>;
  readonly pending: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
}
const EMPTY: FoldersTreeState = {
  status: 'idle',
  enabled: true,
  skipped: 0,
  generation: 0,
  roots: [],
  nodes: new Map(),
  children: new Map(),
  expanded: new Set(),
  pending: new Set(),
  failed: new Set(),
};
const stateAtom = atom<FoldersTreeState>(EMPTY);
export const foldersTreeAtom: Atom<FoldersTreeState> = atom((get) => get(stateAtom));
export type FoldersHost = FoldersTreeFace & HostReadyFace & LibraryEventsFace;
export interface FoldersTreeService {
  want(): () => void;
  retry(): Promise<void>;
  expand(key: string, open?: boolean): Promise<void>;
  expandRecursive(keys: readonly string[], open: boolean): Promise<void>;
  restore(expanded: ReadonlySet<string>): Promise<void>;
  locate(key: string): Promise<FolderNode | null>;
  dispose(): void;
}
export function startFoldersTree(store: Store, host: FoldersHost = fb): FoldersTreeService {
  store.set(stateAtom, EMPTY);
  const waiter = waitForHost(host);
  let disposed = false;
  let active = 0;
  let dirty = true;
  let serial = 0;
  let restoring = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expanded: ReadonlySet<string> = new Set();
  let cache = makeCache();
  let loading: Promise<void> | null = null;
  function update(change: Partial<FoldersTreeState>) {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...change });
  }
  function publish() {
    if (store.get(stateAtom).status !== 'ready') return;
    update({
      nodes: new Map(cache.nodes),
      children: new Map(cache.children),
      expanded,
      pending: new Set(cache.pending.keys()),
      failed: new Set(cache.failed),
    });
  }
  function makeCache() {
    const mine = serial;
    return createFoldersCache(host, () => !disposed && active > 0 && mine === serial, publish);
  }
  async function refresh() {
    const mine = ++serial;
    cache = makeCache();
    const working = cache;
    update({ status: 'loading' });
    if (!(await connected) || disposed || mine !== serial || active === 0) return;
    const answer = await settle(() => host.library.getRoots());
    if (disposed || mine !== serial || active === 0) return;
    if (!answer || answer.success === false) {
      update({ status: 'failed' });
      return;
    }
    const roots = answer.roots.map(foldersRoot);
    for (const root of roots) working.nodes.set(root.key, root);
    for (const key of expanded) {
      const node = await working.locate(key);
      if (node) await working.load(node.key);
      if (disposed || mine !== serial || active === 0) return;
    }
    expanded = new Set([...expanded].filter((key) => working.nodes.has(key)));
    dirty = false;
    update({
      status: 'ready',
      roots: roots.map((node) => node.key),
      enabled: answer.enabled,
      skipped: answer.skippedTracks,
      generation: store.get(stateAtom).generation + 1,
      nodes: new Map(cache.nodes),
      children: new Map(cache.children),
      expanded,
      pending: new Set(cache.pending.keys()),
      failed: new Set(cache.failed),
    });
  }
  function retry(): Promise<void> {
    const next = refresh();
    loading = next;
    void next.finally(() => {
      if (loading === next) loading = null;
    });
    return next;
  }
  let off = () => {};
  const connected = waiter.done.then((arrived) => {
    if (!arrived || disposed) return false;
    off = onLibraryChanged(host, () => {
      dirty = true;
      serial += 1;
      restoring += 1;
      if (active > 0) update({ status: 'loading' });
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (active > 0) void retry();
      }, LIBRARY_COALESCE_MS);
    });
    return true;
  });
  return {
    want() {
      active += 1;
      if (dirty && !loading) void retry();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        if (active === 0) {
          serial += 1;
          loading = null;
          dirty = true;
        }
      };
    },
    retry,
    async expand(key, open = !expanded.has(key)) {
      restoring += 1;
      if (disposed || active === 0) return;
      const next = new Set(expanded);
      if (open) next.add(key);
      else next.delete(key);
      expanded = next;
      publish();
      if (open) await cache.load(key);
    },
    async expandRecursive(keys, open) {
      const mine = ++restoring;
      if (disposed || active === 0 || store.get(stateAtom).status !== 'ready') return;
      const working = cache;
      const current = () => mine === restoring && working === cache && !disposed && active > 0;
      const queue = [...keys];
      const seen = new Set<string>();
      for (let index = 0; index < queue.length && current(); index += 1) {
        const key = queue[index];
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const node = working.nodes.get(key);
        if (!node) continue;
        const next = new Set(expanded);
        if (open && node.hasChildren) next.add(key);
        else next.delete(key);
        expanded = next;
        publish();
        if (open && node.hasChildren) await working.load(key);
        if (!current()) return;
        queue.push(...(working.children.get(key) ?? []));
      }
    },
    async restore(keys) {
      const mine = ++restoring;
      if (loading) await loading;
      if (disposed || active === 0) return;
      const working = cache;
      const kept = new Set<string>();
      for (const key of keys) {
        const node = await working.locate(key);
        if (node) {
          kept.add(node.key);
          await working.load(node.key);
        }
        if (mine !== restoring || working !== cache || disposed || active === 0) return;
      }
      expanded = kept;
      publish();
    },
    async locate(key) {
      if (loading) await loading;
      const working = cache;
      const node = await working.locate(key);
      return working === cache && !disposed && active > 0 ? node : null;
    },
    dispose() {
      disposed = true;
      serial += 1;
      off();
      waiter.cancel();
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
