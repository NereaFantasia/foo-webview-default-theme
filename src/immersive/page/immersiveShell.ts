import type { WindowStateChangedPayload } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { historyAtom, type NavHistoryService } from '../../nav/navHistory.ts';
import { START_PLACE } from '../../nav/places.ts';
import type { Store } from '../../kit/store.ts';

/**
 * 正在播放全屏页的壳：控件层的静止计时、宿主主窗全屏的记账，以及离开这一页。
 *
 * 页面挂上时启动，启动时的当前历史记录就是这一页；这条不再是当前记录（后退、前进或去了别处），
 * 或者页面卸下调了 `dispose()`，都算离开，以先到的为准。离开之后不再写状态，也不再响应宿主事件：
 * 页面在退场过渡里还挂着，这段时间宿主报的全屏变化不能再触发一次后退。
 *
 * 全屏：宿主在时先订 `window:stateChanged`，再问一次 `isFullscreen`，`hostFullscreenAtom` 跟着宿主走；
 * 问不到（面板模式、这扇窗不支持全屏）是 null。视图让宿主进的全屏（进入时按偏好，或按视图里的全屏键）
 * 只在 `enterFullscreen` 应答 `isFullscreen: true` 时记账；离开时只退记了账的那一次，进视图前宿主已经
 * 全屏的不动。命令失败或没有宿主（浏览器里跑开发服务器）时照常留在视图里，不算失败。
 * 记了账的全屏被宿主侧自己退了（用户按了宿主的快捷键）时跟着离开这一页，且不再发退出命令。
 *
 * `window:stateChanged` 发给所有窗口，只认本窗口的：窗口 id 经 `getCurrentWindowId` 取回之前按主窗 `main` 认。
 *
 * 同一时刻只有一个壳在跟宿主：启动时进入时全屏的命令推到下一个微任务再发，发之前壳已释放就不发（开发时
 * React 的严格模式会把页面挂上、立即卸下、再挂上，第一个壳不该发命令）。已经离开的壳等到进入全屏的成功应答时，
 * 这一页若又有了新的壳，记账交给它，不发退出。
 */

/** 指针与键盘都静止这么久（毫秒）后藏控件层与光标；有指针移动或按键立刻回来。 */
export const IDLE_HIDE_MS = 3000;

/** 壳用到的宿主接口，类型逐项取自 SDK 的 `fb`。 */
export interface ImmersiveHost {
  isAvailable: typeof fb.isAvailable;
  on: typeof fb.on;
  ui: Pick<
    typeof fb.ui,
    'enterFullscreen' | 'exitFullscreen' | 'isFullscreen' | 'getCurrentWindowId'
  >;
}

/** 窗口 id 取回之前按主窗认：沉浸视图只在主窗里。 */
const MAIN_WINDOW_ID = 'main';

/** 过 `ms` 毫秒调一次 `run`，返回取消函数。 */
export type Schedule = (run: () => void, ms: number) => () => void;

export interface ImmersiveShellDeps {
  history: Pick<NavHistoryService, 'back' | 'navigate'>;
  /** 进入时要不要让宿主主窗一起全屏；启动时读一次。 */
  fullscreenOnEnter: () => boolean;
  host?: ImmersiveHost;
  /** 静止计时用的定时器，缺省是 `setTimeout`。 */
  schedule?: Schedule;
}

export interface ImmersiveShell {
  /** 这一页还是当前地点、壳还没释放；视图里的按键命令据此决定认不认领。 */
  current(): boolean;
  /** 有指针移动或按键：控件层与光标立刻回来，静止计时从头数。 */
  touch(): void;
  /** 视图里的全屏键：宿主全屏就退，否则进。宿主不在或不支持全屏时不动。 */
  toggleFullscreen(): Promise<void>;
  /**
   * 离开这一页：Esc 与右上的 Esc 胶囊调它。视图让宿主进的全屏先退，再后退；
   * 后退退不回去（前面的记录都被历史上限挤掉了）时去 `START_PLACE`。
   */
  leave(): void;
  dispose(): void;
}

interface ShellState {
  readonly controlsVisible: boolean;
  readonly hostFullscreen: boolean | null;
}

const INITIAL: ShellState = { controlsVisible: true, hostFullscreen: null };
const stateAtom = atom<ShellState>(INITIAL);

/** 控件层与光标此刻该不该显示。 */
export const controlsVisibleAtom: Atom<boolean> = atom((get) => get(stateAtom).controlsVisible);
/** 宿主主窗此刻是否全屏；null 是不知道或不支持，视图里的全屏键不出。只在壳开着时跟宿主。 */
export const hostFullscreenAtom: Atom<boolean | null> = atom(
  (get) => get(stateAtom).hostFullscreen,
);

const browserSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** 正在跟宿主的那个壳；已经离开的壳晚到的全屏记账交给它。 */
let liveShell: { adopt(): void } | null = null;

export function startImmersiveShell(store: Store, deps: ImmersiveShellDeps): ImmersiveShell {
  const { history, host = fb, schedule = browserSchedule } = deps;
  const own = store.get(historyAtom).entry;
  store.set(stateAtom, INITIAL);
  let left = false;
  // 视图让宿主确实进了全屏才为真：离开时据它决定要不要发 exitFullscreen。
  let entered = false;
  // 每写一次全屏态加一：`isFullscreen` 的初读晚于事件或命令应答到达时丢掉。
  let fullscreenWrites = 0;
  let cancelIdle: (() => void) | undefined;
  let offState: (() => void) | undefined;
  let windowId = MAIN_WINDOW_ID;
  const self = {
    // 已经离开的壳让宿主进了全屏：这一页还开着，记账归这个壳。
    adopt(): void {
      if (left) return;
      entered = true;
      setFullscreen(true);
    },
  };
  liveShell = self;

  // 离开之后不写：新的一页可能已经启动了自己的壳，共用同一份状态。
  function update(patch: Partial<ShellState>): void {
    if (left) return;
    const state = store.get(stateAtom);
    const next = { ...state, ...patch };
    if (
      next.controlsVisible !== state.controlsVisible ||
      next.hostFullscreen !== state.hostFullscreen
    ) {
      store.set(stateAtom, next);
    }
  }

  function setFullscreen(fullscreen: boolean | null): void {
    fullscreenWrites += 1;
    update({ hostFullscreen: fullscreen });
  }

  function armIdle(): void {
    cancelIdle?.();
    cancelIdle = schedule(() => {
      cancelIdle = undefined;
      update({ controlsVisible: false });
    }, IDLE_HIDE_MS);
  }

  // 失败只可能是本来就不在全屏（宿主答 OPERATION_FAILED）或宿主不在，都不用再做什么。
  function exitHostFullscreen(): void {
    void settle(() => host.ui.exitFullscreen());
  }

  function goBack(): void {
    if (!history.back()) history.navigate(START_PLACE);
  }

  function depart(): void {
    if (left) return;
    left = true;
    if (liveShell === self) liveShell = null;
    cancelIdle?.();
    cancelIdle = undefined;
    offState?.();
    offState = undefined;
    offHistory();
    if (!entered) return;
    entered = false;
    exitHostFullscreen();
  }

  function onStateChanged(payload: WindowStateChangedPayload): void {
    if (left || payload.windowId !== windowId) return;
    const { isFullscreen } = payload;
    setFullscreen(isFullscreen);
    // 视图让它进的全屏被宿主自己退了：它已不在全屏里，只后退，不再发 exitFullscreen。
    if (entered && !isFullscreen) {
      entered = false;
      goBack();
    }
  }

  async function probeFullscreen(): Promise<void> {
    const mine = fullscreenWrites;
    const answer = await settle(() => host.ui.isFullscreen());
    if (mine !== fullscreenWrites) return;
    setFullscreen(answer !== null && answer.success ? answer.isFullscreen : null);
  }

  async function requestFullscreen(): Promise<void> {
    const answer = await settle(() => host.ui.enterFullscreen());
    if (answer === null || !answer.success || !answer.isFullscreen) return;
    if (!left) {
      self.adopt();
      return;
    }
    // 等应答期间已经离开：这一页又有了新的壳就交给它；没有就补一次退出，不把主窗留在全屏里。
    if (liveShell) liveShell.adopt();
    else exitHostFullscreen();
  }

  async function enterOnStart(): Promise<void> {
    await Promise.resolve();
    if (!left) await requestFullscreen();
  }

  async function readWindowId(): Promise<void> {
    const answer = await settle(() => host.ui.getCurrentWindowId());
    if (!left && answer !== null && answer.success) windowId = answer.windowId;
  }

  const offHistory = store.sub(historyAtom, () => {
    if (store.get(historyAtom).entry !== own) depart();
  });

  armIdle();
  // 宿主缺席时 SDK 的调用要等约 100 ms 才答 `NOT_SUPPORTED`：不问它，没有全屏键。
  if (host.isAvailable()) {
    offState = host.on('window:stateChanged', onStateChanged);
    void readWindowId();
    void probeFullscreen();
    if (deps.fullscreenOnEnter()) void enterOnStart();
  }

  return {
    current: () => !left,
    touch() {
      if (left) return;
      update({ controlsVisible: true });
      armIdle();
    },
    async toggleFullscreen() {
      if (left) return;
      const fullscreen = store.get(stateAtom).hostFullscreen;
      if (fullscreen === null) return;
      if (!fullscreen) {
        await requestFullscreen();
        return;
      }
      // 自己退的不算宿主侧退出：先清记账，随后的 stateChanged 就不会连带离开这一页。
      entered = false;
      const answer = await settle(() => host.ui.exitFullscreen());
      // 退不出就留在全屏，状态等 stateChanged 来纠正。
      if (answer !== null && answer.success) setFullscreen(answer.isFullscreen);
    },
    leave() {
      if (left) return;
      if (entered) {
        entered = false;
        exitHostFullscreen();
      }
      goBack();
    },
    dispose: depart,
  };
}
