import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  type LibraryEventsFace,
} from '../../host/libraryContract.ts';
import type { Store } from '../../kit/store.ts';

/** 根目录最多列几行，多出的只报个数。 */
export const ROOTS_SHOWN = 4;

/**
 * 曲目数多久不变才取根目录，毫秒。`library.getRoots` 第一次调用会在宿主里同步建目录索引，
 * 扫描期间曲目数每变一次就取一回，大媒体库会把宿主卡住。
 */
export const ROOTS_SETTLE_MS = 2000;

export interface LibraryRootLine {
  /** 根目录的本地路径。 */
  readonly path: string;
  readonly trackCount: number;
}

/**
 * 第 1 步看到的媒体库。`enabled` 时 `count` 为 0 是「已添加，尚未找到曲目」；`roots` 只含本地路径下的
 * 根目录（网络路径、压缩包里的曲目不进根目录），取到之前是空的。
 */
export type OnboardingLibrary =
  | { readonly phase: 'reading' | 'failed' | 'disabled' }
  | {
      readonly phase: 'enabled';
      readonly count: number;
      readonly roots: readonly LibraryRootLine[];
      /** 超出 `ROOTS_SHOWN` 没列出来的根目录个数。 */
      readonly moreRoots: number;
    };

export interface OnboardingLibraryHost extends LibraryEventsFace {
  readonly library: Pick<typeof fb.library, 'getStatus' | 'getRoots'>;
  readonly config: Pick<typeof fb.config, 'getLibraryStatus'>;
}

export interface OnboardingLibraryWatch {
  readonly state: Atom<OnboardingLibrary>;
  /** 立刻重读一次。添加一个还没有曲目的文件夹不会发媒体库事件，回到窗口时由调用方补读。 */
  refresh(): void;
  dispose(): void;
}

const READING: OnboardingLibrary = { phase: 'reading' };

/**
 * 只在引导打开期间跟着媒体库：曲目数与是否启用读 `library.getStatus`（宿主有缓存）；媒体库事件按
 * `LIBRARY_COALESCE_MS` 节流，扫描期间曲目数照样一秒一涨，不等扫描结束。宿主不报告扫描进度，
 * 所以没有「正在扫描」这一态。
 */
export function watchOnboardingLibrary(
  store: Store,
  host: OnboardingLibraryHost = fb,
): OnboardingLibraryWatch {
  const state = atom<OnboardingLibrary>(READING);
  let disposed = false;
  let generation = 0;
  let rootsGeneration = 0;
  let lastCount: number | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let rootsTimer: ReturnType<typeof setTimeout> | undefined;

  function clearRoots(): void {
    rootsGeneration += 1;
    if (rootsTimer !== undefined) clearTimeout(rootsTimer);
    rootsTimer = undefined;
  }

  async function loadRoots(ticket: number): Promise<void> {
    const answer = await settle(() => host.library.getRoots());
    const current = store.get(state);
    if (disposed || ticket !== rootsGeneration || current.phase !== 'enabled') return;
    if (!answer || answer.success === false) return;
    const roots = answer.roots.map((root) => ({
      path: root.absolutePath,
      trackCount: root.trackCount,
    }));
    store.set(state, {
      ...current,
      roots: roots.slice(0, ROOTS_SHOWN),
      moreRoots: Math.max(0, roots.length - ROOTS_SHOWN),
    });
  }

  function scheduleRoots(): void {
    clearRoots();
    const ticket = rootsGeneration;
    rootsTimer = setTimeout(() => {
      rootsTimer = undefined;
      void loadRoots(ticket);
    }, ROOTS_SETTLE_MS);
  }

  async function read(): Promise<void> {
    const ticket = ++generation;
    const answer = await settle(() => host.library.getStatus());
    if (disposed || ticket !== generation) return;
    if (!answer || answer.success === false) {
      // 读到过一次就留着上一次的样子，只有第一次就读不到才算失败。
      if (store.get(state).phase === 'reading') store.set(state, { phase: 'failed' });
      return;
    }
    if (!answer.enabled) {
      clearRoots();
      lastCount = null;
      store.set(state, { phase: 'disabled' });
      return;
    }
    const previous = store.get(state);
    const keep = previous.phase === 'enabled' && answer.itemCount > 0;
    store.set(state, {
      phase: 'enabled',
      count: answer.itemCount,
      roots: keep ? previous.roots : [],
      moreRoots: keep ? previous.moreRoots : 0,
    });
    if (answer.itemCount === lastCount) return;
    lastCount = answer.itemCount;
    if (answer.itemCount > 0) scheduleRoots();
    else clearRoots();
  }

  function schedule(): void {
    if (disposed || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void read();
    }, LIBRARY_COALESCE_MS);
  }

  const offLibrary = onLibraryChanged(host, schedule);

  async function start(): Promise<void> {
    // 这个接口每次都遍历整个媒体库，只在开头问一次载没载完；没载完就等 library:initialized。
    const loading = await settle(() => host.config.getLibraryStatus());
    if (disposed) return;
    if (loading && loading.success !== false && !loading.initialized) return;
    await read();
  }
  void start();

  return {
    state: atom((get) => get(state)),
    refresh() {
      if (!disposed) void read();
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearRoots();
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      offLibrary();
    },
  };
}
