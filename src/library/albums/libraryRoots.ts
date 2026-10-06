import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { relativeBaseOf } from '../../host/hostPath.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  type LibraryEventsFace,
} from '../../host/libraryContract.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';

export interface LibraryRootsState {
  /** 各库根的绝对路径；没取到是空的，「媒体库一级目录」分节于是全落「未知」节。 */
  readonly roots: readonly string[];
  /** 便携安装下 `file-relative://` 的基准目录；非便携安装的曲目路径本就是绝对的，用不上它。 */
  readonly relativeBase: string | null;
  /** 第一次读取做完了，读失败也算；「媒体库一级目录」分节据此不再等。 */
  readonly loaded: boolean;
}

const INITIAL: LibraryRootsState = { roots: [], relativeBase: null, loaded: false };
const stateAtom = atom<LibraryRootsState>(INITIAL);

export const libraryRootsAtom: Atom<LibraryRootsState> = atom((get) => get(stateAtom));

export interface LibraryRootsFace extends HostReadyFace, LibraryEventsFace {
  library: Pick<typeof fb.library, 'getRoots'>;
  misc: Pick<typeof fb.misc, 'getProfilePath'>;
}

export interface LibraryRootsService {
  readonly ready: Promise<void>;
  dispose(): void;
}

type RootsAnswer = Awaited<ReturnType<LibraryRootsFace['library']['getRoots']>>;

function rootsOf(answer: RootsAnswer | null): readonly string[] | null {
  if (!answer || answer.success === false) return null;
  return answer.roots.map((root) => root.absolutePath).filter((path) => path.length > 0);
}

/**
 * 库根与 profile 目录，只为「按媒体库一级目录分节」。改库根要经 fb2k 的首选项，改完媒体库会发变更事件：
 * 事件停下 `LIBRARY_COALESCE_MS` 之后重取库根（扫描期间事件不停，每次重取都会重建宿主的目录索引，
 * 所以等它停下）。重取失败留着上一次的库根。profile 目录运行期间不变，只取一次。
 */
export function startLibraryRoots(store: Store, host: LibraryRootsFace = fb): LibraryRootsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offLibrary: (() => void) | undefined;
  const waiter = waitForHost(host);

  async function reload(): Promise<void> {
    const ticket = ++generation;
    const roots = rootsOf(await settle(() => host.library.getRoots()));
    if (disposed || ticket !== generation || roots === null) return;
    store.set(stateAtom, (state) => ({ ...state, roots }));
  }

  function schedule(): void {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void reload();
    }, LIBRARY_COALESCE_MS);
  }

  async function load(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    offLibrary = onLibraryChanged(host, schedule);
    const ticket = ++generation;
    const [roots, profile] = await Promise.all([
      settle(() => host.library.getRoots()),
      settle(() => host.misc.getProfilePath()),
    ]);
    if (disposed) return;
    store.set(stateAtom, (state) => ({
      // 第一次读回来之前已经因变更重取过，以重取的为准。
      roots: ticket === generation ? (rootsOf(roots) ?? []) : state.roots,
      relativeBase:
        profile && profile.success !== false && profile.path ? relativeBaseOf(profile.path) : null,
      loaded: true,
    }));
  }

  return {
    ready: load(),
    dispose() {
      disposed = true;
      generation += 1;
      waiter.cancel();
      if (timer !== undefined) clearTimeout(timer);
      offLibrary?.();
    },
  };
}
