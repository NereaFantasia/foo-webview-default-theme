import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { HostReadyFace } from '../host/waitForHost.ts';
import { localeAtom } from '../i18n/locale.ts';
import {
  EMPTY_CONTEXT_TREE,
  FAILED_CONTEXT_TREE,
  readContextTree,
  type ContextMenuFace,
  type ContextTree,
} from '../host/contextMenu.ts';
import type { Store } from '../kit/store.ts';
import { MENU_HANDLES_LIMIT } from './albumMenu.ts';
import { trackPathOf } from '../host/libraryContract.ts';
import { readSendTargets, type SendTarget } from '../track/trackListActions.ts';

/** 曲目菜单此刻针对的那一批：列表形态里右键曲目行时选中的行。 */
export interface TrackMenuState {
  /** 作用对象，按显示顺序。 */
  readonly tracks: readonly LibraryTrack[];
  /** 右键落在的那一首：「转到专辑」去它的专辑。没给时取作用对象的第一首。 */
  readonly anchor: LibraryTrack | null;
  readonly ratingStamp: number;
  /** 「发送到」子菜单的目标。 */
  readonly targets: readonly SendTarget[];
  /** 「更多命令」：宿主对这批曲目的上下文命令树；还没读到或过了上限是空树。 */
  readonly tree: ContextTree;
}

const EMPTY_MENU: TrackMenuState = {
  tracks: [],
  anchor: null,
  ratingStamp: 0,
  targets: [],
  tree: EMPTY_CONTEXT_TREE,
};
const stateAtom = atom<TrackMenuState>(EMPTY_MENU);

export const trackMenuAtom: Atom<TrackMenuState> = atom((get) => get(stateAtom));

export interface TrackMenuFace extends Pick<HostReadyFace, 'isAvailable'>, ContextMenuFace {
  playlist: Pick<typeof fb.playlist, 'getAll'>;
}

export interface TrackMenuService {
  /**
   * 菜单打开前调：定下作用对象，再读「发送到」的目标与「更多命令」树，都到手时兑现。曲目本来就在手上，
   * 播放、入队、发送不用等。连着打开两次时，先打开的那一批晚到的结果丢掉。
   */
  prepare(
    tracks: readonly LibraryTrack[],
    anchor?: LibraryTrack,
    ratingStamp?: number,
  ): Promise<void>;
  retry(): Promise<void>;
  close(): void;
  dispose(): void;
}

export function startTrackMenu(store: Store, host: TrackMenuFace = fb): TrackMenuService {
  store.set(stateAtom, EMPTY_MENU);
  let disposed = false;
  let generation = 0;
  let treeRequest = 0;
  const update = (change: Partial<TrackMenuState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });

  async function retry() {
    if (disposed) return;
    const mine = generation;
    const request = ++treeRequest;
    const { tracks } = store.get(stateAtom);
    if (!host.isAvailable()) return update({ tree: FAILED_CONTEXT_TREE });
    if (!tracks.length || tracks.length > MENU_HANDLES_LIMIT)
      return update({ tree: { ...EMPTY_CONTEXT_TREE, loading: false } });
    update({ tree: EMPTY_CONTEXT_TREE });
    const tree = await readContextTree(
      host,
      { mode: 'handles', handles: tracks.map(trackPathOf) },
      store.get(localeAtom).base,
    );
    if (!disposed && mine === generation && request === treeRequest) update({ tree });
  }

  return {
    retry,
    async prepare(tracks, anchor, ratingStamp = 0) {
      const mine = ++generation;
      const current = () => !disposed && mine === generation;
      store.set(stateAtom, {
        ...EMPTY_MENU,
        tracks: [...tracks],
        anchor: anchor ?? tracks[0] ?? null,
        ratingStamp,
      });
      if (disposed) return;
      if (!host.isAvailable()) return update({ tree: FAILED_CONTEXT_TREE });
      const targets = readSendTargets(host).then((list) => {
        if (current()) update({ targets: list });
      });
      await retry();
      await targets;
    },
    close() {
      generation += 1;
    },
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}
