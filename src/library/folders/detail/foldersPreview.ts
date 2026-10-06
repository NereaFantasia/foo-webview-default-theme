import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import { FOLDERS_LIMIT, foldersDirectory, type FolderNode } from '../tree/foldersModel.ts';
import { foldersSort } from './foldersSort.ts';

export interface FoldersPreviewState {
  readonly node: FolderNode | null;
  readonly nodes: readonly FolderNode[];
  readonly directories: readonly FolderNode[];
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'limited';
  readonly tracks: readonly LibraryTrack[];
  readonly stamp: number;
}
const EMPTY: FoldersPreviewState = {
  node: null,
  nodes: [],
  directories: [],
  status: 'idle',
  tracks: [],
  stamp: 0,
};
const stateAtom = atom<FoldersPreviewState>(EMPTY);
export const foldersPreviewAtom: Atom<FoldersPreviewState> = atom((get) => get(stateAtom));
export interface FoldersPreviewFace {
  library: Pick<typeof fb.library, 'browseTree'>;
}
export interface FoldersPreviewService {
  select(node: FolderNode | null, delay?: number): void;
  selectMany(nodes: readonly FolderNode[], delay?: number): void;
  retry(): void;
  dispose(): void;
}
export async function readFoldersTracks(
  host: FoldersPreviewFace,
  node: FolderNode,
): Promise<readonly LibraryTrack[] | null> {
  if (node.count > FOLDERS_LIMIT) return null;
  const answer = await settle(() =>
    host.library.browseTree({
      rootId: node.rootId,
      pathId: node.pathId,
      includeFiles: true,
      recursiveFiles: true,
    }),
  );
  if (!answer || answer.success === false || answer.files.length > FOLDERS_LIMIT) return null;
  return foldersSort(
    [...new Map(answer.files.map((track) => [track.handle, track])).values()],
    null,
  );
}
export function startFoldersPreview(
  store: Store,
  stamp: () => number,
  host: FoldersPreviewFace = fb,
): FoldersPreviewService {
  store.set(stateAtom, EMPTY);
  let serial = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function load(nodes: readonly FolderNode[], mine: number) {
    const at = stamp();
    const tracks = new Map<string, LibraryTrack>();
    const directories = new Map<string, FolderNode>();
    let limited = nodes.some((node) => node.count > FOLDERS_LIMIT);
    for (const node of nodes) {
      if (disposed || mine !== serial) return;
      const answer = await settle(() =>
        host.library.browseTree({
          rootId: node.rootId,
          pathId: node.pathId,
          ...(!limited ? { includeFiles: true, recursiveFiles: true } : {}),
        }),
      );
      if (disposed || mine !== serial) return;
      if (!answer || answer.success === false) {
        store.set(stateAtom, { ...store.get(stateAtom), status: 'failed' });
        return;
      }
      for (const directory of answer.directories) {
        const child = foldersDirectory(directory);
        directories.set(child.key, child);
      }
      for (const track of answer.files) tracks.set(track.handle, track);
      limited ||= tracks.size > FOLDERS_LIMIT;
    }
    store.set(stateAtom, {
      node: nodes[0] ?? null,
      nodes,
      directories: [...directories.values()],
      stamp: at,
      status: limited ? 'limited' : 'ready',
      tracks: limited ? [] : foldersSort([...tracks.values()], null),
    });
  }
  function selectMany(nodes: readonly FolderNode[], delay = 0) {
    const mine = ++serial;
    if (timer !== undefined) clearTimeout(timer);
    if (disposed) return;
    const node = nodes[0] ?? null;
    const status = !node
      ? 'idle'
      : nodes.some((item) => item.count > FOLDERS_LIMIT)
        ? 'limited'
        : 'loading';
    store.set(stateAtom, { ...EMPTY, node, nodes, status });
    if (!node) return;
    if (delay) timer = setTimeout(() => void load(nodes, mine), delay);
    else void load(nodes, mine);
  }
  return {
    select: (node, delay) => selectMany(node ? [node] : [], delay),
    selectMany,
    retry: () => selectMany(store.get(stateAtom).nodes),
    dispose() {
      disposed = true;
      serial += 1;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
