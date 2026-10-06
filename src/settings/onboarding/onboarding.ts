import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { settle } from '../../host/hostCall.ts';
import type { LibraryEventsFace } from '../../host/libraryContract.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { Store } from '../../kit/store.ts';
import {
  watchOnboardingLibrary,
  type OnboardingLibrary,
  type OnboardingLibraryWatch,
} from './onboardingLibrary.ts';

/** 引导记录存在宿主 config 里，跟着 profile 走：重装主题、换模板目录都还在。 */
export const ONBOARDING_KEY = 'defaultTheme.onboarding.record';

/** 记录的版本。以后给已经走完的人补新的一步时，按它判断要补哪几步。 */
export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STEPS = ['library', 'appearance', 'tray', 'update'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingOutcome = 'completed' | 'skipped';

export interface OnboardingState {
  readonly open: boolean;
  readonly step: OnboardingStep;
  /** 最近一次换步的方向，换步动效按它决定新内容从哪一侧进。 */
  readonly direction: 'forward' | 'back';
}

export interface OnboardingHost extends HostReadyFace, LibraryEventsFace {
  readonly config: Pick<typeof fb.config, 'get' | 'getLibraryStatus'>;
  readonly library: Pick<typeof fb.library, 'getStatus' | 'getRoots'>;
  readonly ui: Pick<typeof fb.ui, 'getCurrentWindowId'>;
}

export interface OnboardingDeps {
  readonly writer: Pick<ConfigWriter, 'set'>;
  /** 宿主版本核对做完时兑现；在这之前还不知道有没有阻断级消息。 */
  readonly checked: Promise<unknown>;
  /** 信息中心此刻有没有阻断级消息。 */
  readonly blocking: Atom<boolean>;
  /** 启动等待层收起之后兑现，对话框在它之后才打开，入场动效不被等待层盖住。 */
  readonly shown: Promise<unknown>;
}

export interface OnboardingService {
  readonly state: Atom<OnboardingState>;
  /** 第 1 步的媒体库。只在引导打开期间跟着宿主，关掉后停在最后的样子。 */
  readonly library: Atom<OnboardingLibrary>;
  /** 回到窗口时重读媒体库：添加一个还没有曲目的文件夹不会发媒体库事件。 */
  refreshLibrary(): void;
  next(): void;
  back(): void;
  /**
   * 关掉引导并写记录，写成了答 true。没写成也关：本次运行不再打开，下次启动再打开。
   * 记录只写一次：先 `save` 过或重复调用，都答第一次写的结果。
   */
  finish(outcome: OnboardingOutcome): Promise<boolean>;
  /** 只写记录、不关：重启前用，重启没成时引导还开着，看得到出错的原因。 */
  save(outcome: OnboardingOutcome): Promise<boolean>;
  dispose(): void;
}

const CLOSED: OnboardingState = { open: false, step: 'library', direction: 'forward' };
const READING: OnboardingLibrary = { phase: 'reading' };

/**
 * 判断这次启动要不要打开引导，打开后管换步与收尾。四条都满足才打开：连上宿主；确认 config 里没有
 * 记录（读失败不算没有，宁可这次不打扰）；当前是主窗口；版本核对后没有阻断级消息。
 */
export function startOnboarding(
  store: Store,
  deps: OnboardingDeps,
  host: OnboardingHost = fb,
): OnboardingService {
  const state = atom<OnboardingState>(CLOSED);
  const libraryWatch = atom<OnboardingLibraryWatch | null>(null);
  const lifetime = new AbortController();
  const waiter = waitForHost(host);
  let disposed = false;
  let written: Promise<boolean> | undefined;

  function stopLibrary(): void {
    store.get(libraryWatch)?.dispose();
  }

  async function shouldOpen(): Promise<boolean> {
    if (!(await waiter.done) || disposed) return false;
    const [record, window] = await Promise.all([
      settle(() => host.config.get(ONBOARDING_KEY)),
      settle(() => host.ui.getCurrentWindowId()),
    ]);
    if (!record || record.success === false || record.found) return false;
    if (!window || window.success === false || window.windowId !== 'main') return false;
    await deps.checked;
    if (disposed || store.get(deps.blocking)) return false;
    await deps.shown;
    return !disposed && !written;
  }

  void shouldOpen().then((open) => {
    waiter.cancel();
    if (!open) return;
    store.set(libraryWatch, watchOnboardingLibrary(store, host));
    store.set(state, { open: true, step: 'library', direction: 'forward' });
  });

  function save(outcome: OnboardingOutcome): Promise<boolean> {
    if (written) return written;
    if (disposed) return Promise.resolve(false);
    written = deps.writer
      .set(ONBOARDING_KEY, { version: ONBOARDING_VERSION, outcome }, lifetime.signal)
      .then(
        (result) => result.success,
        () => false,
      );
    return written;
  }

  function move(offset: 1 | -1): void {
    const current = store.get(state);
    const step = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(current.step) + offset];
    if (disposed || !current.open || !step) return;
    store.set(state, { open: true, step, direction: offset > 0 ? 'forward' : 'back' });
  }

  return {
    state: atom((get) => get(state)),
    library: atom((get) => {
      const watch = get(libraryWatch);
      return watch ? get(watch.state) : READING;
    }),
    refreshLibrary() {
      if (store.get(state).open) store.get(libraryWatch)?.refresh();
    },
    next: () => move(1),
    back: () => move(-1),
    finish(outcome) {
      if (disposed) return written ?? Promise.resolve(false);
      stopLibrary();
      store.set(state, (current) => ({ ...current, open: false }));
      return save(outcome);
    },
    save,
    dispose() {
      disposed = true;
      waiter.cancel();
      stopLibrary();
      lifetime.abort();
    },
  };
}

export const onboardingKey = serviceKey<OnboardingService>('onboarding');
