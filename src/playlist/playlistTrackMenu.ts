import type { MenuCommand } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { localeAtom } from '../i18n/locale.ts';
import {
  EMPTY_CONTEXT_TREE,
  FAILED_CONTEXT_TREE,
  knownCommandsOf,
  readContextTree,
  runContextCommand,
  type ContextMenuFace,
  type ContextTree,
  type KnownCommands,
} from '../host/contextMenu.ts';
import type { Store } from '../kit/store.ts';
import type { PlaylistRowsService } from './playlistRows.ts';
import { playlistsAtom } from '../playback/playlists.ts';
import type { PlaylistSelectionService } from './playlistSelection.ts';

export interface PlaylistTrackMenuState {
  /** 宿主按它那份选中生成的命令树；还没读到、读不到时是空树。 */
  readonly tree: ContextTree;
  /** 从树里认出的属性、评分几样。 */
  readonly known: KnownCommands;
}

const EMPTY: PlaylistTrackMenuState = {
  tree: EMPTY_CONTEXT_TREE,
  known: knownCommandsOf(EMPTY_CONTEXT_TREE),
};

export interface PlaylistTrackMenuDeps {
  readonly selection: Pick<PlaylistSelectionService, 'settle'>;
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
}

export interface PlaylistTrackMenuService {
  readonly stateAtom: Atom<PlaylistTrackMenuState>;
  /** 最近一次执行没办成，或目标已经认不准而没发；下一次办成时收起。 */
  readonly failedAtom: Atom<boolean>;
  dismissFailure(): void;
  /**
   * 开菜单时调：等这张列表的选中推给宿主落地，再按宿主那份选中读命令树。先清成空树，读到之前菜单里宿主的
   * 那几项置灰；又开了一次时，上一次晚到的应答丢掉。这张不是宿主的活动列表时不读，树留空。
   */
  prepare(guid: string): Promise<void>;
  /**
   * 执行树里的一条；目标是生成这棵树时的宿主选中。那之后活动列表换了、或这张列表的内容变过（宿主跟着挪了
   * 选中），树里的编号已经对不上用户看到的那一批，不发，答 false 并记失败。
   */
  run(node: MenuCommand): Promise<boolean>;
  close(): void;
  dispose(): void;
}

/** 生成树的那一刻：哪张列表、它的内容版本。 */
interface Target {
  readonly guid: string;
  readonly contentVersion: number;
}

/**
 * 播放列表页曲目菜单里宿主的那几项（评分、属性、「更多」）。宿主的 `selection` 模式作用于活动列表的选中；
 * 页面的列表进页时会激活，但激活可能被拒、也可能被别处换走，所以读树与执行前都核对活动列表就是这张。
 */
export function createPlaylistTrackMenu(
  store: Store,
  deps: PlaylistTrackMenuDeps,
  host: ContextMenuFace = fb,
): PlaylistTrackMenuService {
  const state = atom(EMPTY);
  const failed = atom(false);
  let generation = 0;
  let target: Target | null = null;
  let disposed = false;
  const versionOf = (guid: string) => store.get(deps.rows.stateOf(guid)).contentVersion;
  const current = (at: Target) =>
    store.get(playlistsAtom).activeGuid === at.guid && versionOf(at.guid) === at.contentVersion;

  return {
    stateAtom: atom((get) => get(state)),
    failedAtom: atom((get) => get(failed)),
    dismissFailure: () => store.set(failed, false),
    async prepare(guid) {
      const mine = ++generation;
      target = null;
      store.set(state, EMPTY);
      const alive = () => !disposed && mine === generation;
      const settled = await deps.selection.settle(guid);
      if (!alive()) return;
      const at: Target = { guid, contentVersion: versionOf(guid) };
      if (!settled || !current(at)) {
        store.set(state, { ...EMPTY, tree: FAILED_CONTEXT_TREE });
        return;
      }
      const tree = await readContextTree(host, { mode: 'selection' }, store.get(localeAtom).base);
      if (!alive()) return;
      if (!current(at)) {
        store.set(state, { ...EMPTY, tree: FAILED_CONTEXT_TREE });
        return;
      }
      target = at;
      store.set(state, { tree, known: knownCommandsOf(tree) });
    },
    async run(node) {
      if (disposed) return false;
      const ok =
        target !== null &&
        current(target) &&
        (await runContextCommand(host, store.get(state).tree, node));
      if (!disposed) store.set(failed, !ok);
      return ok;
    },
    close() {
      generation += 1;
      target = null;
    },
    dispose() {
      disposed = true;
      generation += 1;
      target = null;
    },
  };
}
