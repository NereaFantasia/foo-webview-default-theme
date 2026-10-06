import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import { FOLDERS_LIMIT, foldersHitAddress, foldersSubject } from './foldersModel.ts';
import { foldersTreeAtom, type FoldersTreeService } from './foldersTree.ts';

export interface FoldersFilterState {
  readonly text: string;
  readonly status: 'idle' | 'loading' | 'ready' | 'fallback';
  readonly allowed: ReadonlySet<string> | null;
  readonly matches: number;
}
const EMPTY: FoldersFilterState = { text: '', status: 'idle', allowed: null, matches: 0 };
const stateAtom = atom<FoldersFilterState>(EMPTY);
export const foldersFilterAtom: Atom<FoldersFilterState> = atom((get) => get(stateAtom));
export interface FoldersFilterService {
  setText(text: string): void;
  flush(): void;
  suspend(): void;
  dispose(): void;
}
export function startFoldersFilter(
  store: Store,
  tree: FoldersTreeService,
  host: { library: Pick<typeof fb.library, 'search'> } = fb,
): FoldersFilterService {
  store.set(stateAtom, EMPTY);
  let serial = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let before: ReadonlySet<string> | null = null;
  let generation = 0;
  const update = (change: Partial<FoldersFilterState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...change });
  };
  function cancel() {
    serial += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  async function run() {
    cancel();
    const mine = serial;
    const current = () => !disposed && mine === serial;
    const text = store.get(stateAtom).text.trim();
    if (!text) {
      const saved = before;
      before = null;
      if (saved) await tree.restore(saved);
      if (current()) update({ status: 'idle', allowed: null, matches: 0 });
      return;
    }
    if (store.get(foldersTreeAtom).status !== 'ready') return;
    before ??= store.get(foldersTreeAtom).expanded;
    update({ status: 'loading' });
    const answer = await settle(() =>
      host.library.search(text, FOLDERS_LIMIT, { fields: ['absolutePath'] }),
    );
    if (!current()) return;
    let fallback =
      !answer ||
      answer.success === false ||
      answer.total > FOLDERS_LIMIT ||
      answer.hasMore ||
      answer.tracks.length < answer.total;
    const allowed = new Set<string>();
    const matches = new Set<string>();
    const expanded = new Set<string>();
    const catalog = store.get(foldersTreeAtom);
    const roots = catalog.roots.flatMap((key) => catalog.nodes.get(key) ?? []);
    if (!fallback && answer && answer.success !== false) {
      const subjects = new Set<string>();
      for (const track of answer.tracks) {
        const address = track.absolutePath ? foldersHitAddress(track.absolutePath, roots) : null;
        if (address) subjects.add(foldersSubject(address));
        else fallback = true;
      }
      for (const subject of subjects) {
        const node = await tree.locate(subject);
        if (!current()) return;
        if (!node) {
          fallback = true;
          continue;
        }
        allowed.add(node.key);
        matches.add(node.key);
        let parent = node.parent;
        while (parent) {
          allowed.add(parent);
          expanded.add(parent);
          parent = store.get(foldersTreeAtom).nodes.get(parent)?.parent ?? null;
        }
      }
    }
    if (fallback) {
      allowed.clear();
      matches.clear();
      expanded.clear();
      const needle = text.toLocaleLowerCase();
      for (const root of roots) {
        await tree.expand(root.key, true);
        if (!current()) return;
        const state = store.get(foldersTreeAtom);
        const rootHit = root.name.toLocaleLowerCase().includes(needle);
        for (const key of state.children.get(root.key) ?? []) {
          if (rootHit || state.nodes.get(key)?.name.toLocaleLowerCase().includes(needle)) {
            allowed.add(key);
            matches.add(key);
            allowed.add(root.key);
            expanded.add(root.key);
          }
        }
        if (rootHit) {
          allowed.add(root.key);
          matches.add(root.key);
        }
      }
    }
    if (!current()) return;
    await tree.restore(expanded);
    if (current())
      update({ status: fallback ? 'fallback' : 'ready', allowed, matches: matches.size });
  }
  const off = store.sub(foldersTreeAtom, () => {
    const catalog = store.get(foldersTreeAtom);
    if (catalog.status === 'loading') {
      cancel();
      return;
    }
    if (catalog.status !== 'ready' || catalog.generation === generation) return;
    generation = catalog.generation;
    if (store.get(stateAtom).text.trim()) void run();
  });
  return {
    setText(text) {
      cancel();
      update({ text, status: text.trim() ? 'loading' : 'idle' });
      if (!text.trim()) void run();
      else timer = setTimeout(() => void run(), 300);
    },
    flush: () => {
      void run();
    },
    suspend: cancel,
    dispose() {
      disposed = true;
      cancel();
      off();
    },
  };
}
