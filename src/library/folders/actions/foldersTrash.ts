import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { normalizeHostPath } from '../../../host/hostPath.ts';
import type { Store } from '../../../kit/store.ts';

export interface FoldersTrashItem {
  readonly path: string;
  readonly status: 'pending' | 'ok' | 'failed' | 'unknown' | 'cancelled';
}
export interface FoldersTrashState {
  readonly phase: 'closed' | 'confirm' | 'running' | 'done';
  readonly tracks: number;
  readonly unsupported: number;
  readonly stopping: boolean;
  readonly items: readonly FoldersTrashItem[];
}
const EMPTY: FoldersTrashState = {
  phase: 'closed',
  tracks: 0,
  unsupported: 0,
  stopping: false,
  items: [],
};
const stateAtom = atom<FoldersTrashState>(EMPTY);
export const foldersTrashAtom: Atom<FoldersTrashState> = atom((get) => get(stateAtom));
export interface FoldersTrashFace {
  readonly file: Pick<typeof fb.file, 'getInfo' | 'delete'>;
}
export interface FoldersTrashService {
  prepare(tracks: readonly LibraryTrack[]): void;
  confirm(): Promise<void>;
  cancel(): void;
  dismiss(): void;
  dispose(): void;
}

/** 文件操作只接受宿主已解析的本机绝对路径，不把协议地址或环境变量交给文件接口。 */
export function foldersTrashPaths(tracks: readonly LibraryTrack[]) {
  const paths = new Map<string, string>();
  let unsupported = 0;
  for (const track of tracks) {
    const path = track.absolutePath;
    if (
      !/^[a-z]:[\\/].+/i.test(path) ||
      path.includes('%') ||
      [...path].some((character) => character.charCodeAt(0) < 32) ||
      /[\\/]$/.test(path)
    ) {
      unsupported += 1;
      continue;
    }
    paths.set(normalizeHostPath(path), path);
  }
  return { paths: [...paths.values()], unsupported };
}

export function startFoldersTrash(store: Store, host: FoldersTrashFace = fb): FoldersTrashService {
  store.set(stateAtom, EMPTY);
  let disposed = false;
  let stopped = false;
  const update = (change: Partial<FoldersTrashState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...change });
  };
  return {
    prepare(tracks) {
      if (disposed || store.get(stateAtom).phase === 'running' || !tracks.length) return;
      const { paths, unsupported } = foldersTrashPaths(tracks);
      update({
        phase: 'confirm',
        tracks: tracks.length,
        unsupported,
        stopping: false,
        items: paths.map((path) => ({ path, status: 'pending' })),
      });
    },
    async confirm() {
      const state = store.get(stateAtom);
      if (disposed || state.phase !== 'confirm' || state.unsupported || !state.items.length) return;
      stopped = false;
      const items = [...state.items];
      update({ phase: 'running' });
      for (let index = 0; index < items.length; index += 1) {
        if (disposed || stopped) break;
        const item = items[index];
        if (!item) continue;
        const info = await settle(() => host.file.getInfo(item.path));
        if (disposed || stopped) break;
        let status: FoldersTrashItem['status'] = 'failed';
        if (info?.success === true && info.exists && info.isFile && !info.isDirectory) {
          // 每次只下发一个文件；取消不能撤回宿主已经受理的删除。
          const result = await settle(() => host.file.delete(item.path, { moveToTrash: true }));
          status = result === null ? 'unknown' : result.success ? 'ok' : 'failed';
        }
        items[index] = { ...item, status };
        update({ items: [...items] });
        // 通道超时无法证明未执行，停止后续操作，也不自动重发。
        if (status === 'unknown') break;
      }
      update({
        phase: 'done',
        items: items.map((item) =>
          item.status === 'pending' ? { ...item, status: 'cancelled' } : item,
        ),
      });
    },
    cancel() {
      stopped = true;
      if (store.get(stateAtom).phase === 'running') update({ stopping: true });
      else update(EMPTY);
    },
    dismiss() {
      if (store.get(stateAtom).phase !== 'running') update(EMPTY);
    },
    dispose() {
      disposed = true;
      stopped = true;
    },
  };
}
