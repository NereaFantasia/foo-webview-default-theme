import type { MenuCommand, Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { isHostPlaylist } from '../../../host/hostPlaylists.ts';
import type { HostReadyFace } from '../../../host/waitForHost.ts';
import { localeAtom } from '../../../i18n/locale.ts';
import {
  EMPTY_CONTEXT_TREE,
  FAILED_CONTEXT_TREE,
  readContextTree,
  runContextCommand,
  type ContextMenuFace,
  type ContextTree,
} from '../../../host/contextMenu.ts';
import type { Store } from '../../../kit/store.ts';

export interface QueueMenuFace extends Pick<HostReadyFace, 'isAvailable'>, ContextMenuFace {
  playlist: Pick<typeof fb.playlist, 'getAll' | 'create'>;
  library: Pick<typeof fb.library, 'addToPlaylist'>;
}

/** 按路径建「更多命令」树的条数上限：宿主逐条校验路径，再多就不建，子菜单写明超了上限。 */
export const MENU_PATHS_LIMIT = 500;

/** 「发送到」的一张目标列表，按 GUID 认；锁着的（智能列表也算）置灰。 */
export interface SendTarget {
  readonly guid: string;
  readonly name: string;
  readonly locked: boolean;
}

export interface QueueMenuState {
  /** 作用对象的路径（`path`，非零 subsong 带 `|subsong:N`），按显示顺序。 */
  readonly paths: readonly string[];
  readonly targets: readonly SendTarget[];
  /** 宿主对这批曲目的命令树；还没读到时在读，超了上限是空树。 */
  readonly tree: ContextTree;
  readonly limited: boolean;
}

const EMPTY: QueueMenuState = { paths: [], targets: [], tree: EMPTY_CONTEXT_TREE, limited: false };
const stateAtom = atom<QueueMenuState>(EMPTY);

export const queueMenuAtom: Atom<QueueMenuState> = atom((get) => get(stateAtom));

/** 曲目在宿主那里的路径写法，与媒体库里各处一致。 */
export function pathOf(track: Pick<Track, 'path' | 'subsong'>): string {
  return track.subsong > 0 ? `${track.path}|subsong:${track.subsong}` : track.path;
}

export interface QueueMenuService {
  /** 菜单打开前调：定下作用对象，再读目标列表与命令树。连着打开两次时，先开的那次晚到的结果丢掉。 */
  prepare(paths: readonly string[]): Promise<void>;
  retry(): Promise<void>;
  /** 执行命令树里的一条；目标是建树时的那一批。 */
  run(node: MenuCommand): Promise<boolean>;
  sendTo(guid: string): Promise<boolean>;
  sendToNew(name: string): Promise<boolean>;
  dispose(): void;
}

/** 队列行菜单要向宿主读的两样：「发送到」的目标列表（宿主自己建的几张不列），与「更多命令」的命令树。 */
export function startQueueMenu(store: Store, host: QueueMenuFace = fb): QueueMenuService {
  store.set(stateAtom, EMPTY);
  let disposed = false;
  let generation = 0;
  const update = (mine: number, change: Partial<QueueMenuState>) => {
    if (!disposed && mine === generation)
      store.set(stateAtom, { ...store.get(stateAtom), ...change });
  };
  const ok = (answer: { success?: unknown } | null) => answer?.success === true;

  async function readTree(mine: number): Promise<void> {
    const { paths } = store.get(stateAtom);
    if (!host.isAvailable()) return update(mine, { tree: FAILED_CONTEXT_TREE });
    if (paths.length === 0 || paths.length > MENU_PATHS_LIMIT) {
      return update(mine, { tree: { ...EMPTY_CONTEXT_TREE, loading: false }, limited: true });
    }
    update(mine, { tree: EMPTY_CONTEXT_TREE });
    const locale = store.get(localeAtom).base;
    const tree = await readContextTree(host, { mode: 'handles', handles: paths }, locale);
    update(mine, { tree });
  }

  async function readTargets(mine: number): Promise<void> {
    const all = await settle(() => host.playlist.getAll());
    if (all?.success !== true) return;
    const targets = all.playlists
      .filter(({ name }) => !isHostPlaylist(name))
      .map(({ guid, name, isLocked }) => ({ guid, name, locked: isLocked }));
    update(mine, { targets });
  }

  const addTo = async (guid: string, paths: readonly string[]) => {
    if (disposed || paths.length === 0) return false;
    return ok(await settle(() => host.library.addToPlaylist([...paths], guid)));
  };

  return {
    async prepare(paths) {
      const mine = ++generation;
      store.set(stateAtom, { ...EMPTY, paths: [...paths] });
      await Promise.all([readTargets(mine), readTree(mine)]);
    },
    retry: () => readTree(generation),
    run: (node) => runContextCommand(host, store.get(stateAtom).tree, node),
    sendTo: (guid) => addTo(guid, store.get(stateAtom).paths),
    async sendToNew(name) {
      // 新建期间可以打开另一首的菜单，已发起的发送仍使用原来的曲目。
      const paths = [...store.get(stateAtom).paths];
      if (disposed || paths.length === 0) return false;
      const created = await settle(() => host.playlist.create(name));
      return created?.success === true && addTo(created.guid, paths);
    },
    dispose() {
      disposed = true;
      generation++;
    },
  };
}
