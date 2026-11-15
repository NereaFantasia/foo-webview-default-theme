import type { WindowStateChangedPayload } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { mainHistoryAtom, type NavHistoryService } from '../../nav/navHistory.ts';
import { START_PLACE } from '../../nav/places.ts';
import type { Store } from '../../kit/store.ts';

/**
 * 沉浸全屏视图外壳：控件层闲置超时管理、宿主主窗口全屏状态联动与视图退出调度
 *
 * 页面加载完成时启动，由应用持有。启动时的历史记录不再是当前记录，或应用调用了 `dispose()`，都算离开视图（以先发生者为准），
 * 页面隐藏时暂停控件闲置计时。离开视图后不再更新状态，亦不响应宿主事件：避免退场过渡动画期间因宿主全屏状态变化二次触发导航后退
 *
 * 全屏管理：宿主可用时先订阅 `window:stateChanged`，并初次查询 `isFullscreen`，`hostFullscreenAtom` 实时同步宿主状态
 * 查询失败（面板模式或当前窗口不支持全屏）时置为 null。由本视图请求进入的全屏（进入时按偏好自动触发，或点击视图全屏按钮）
 * 仅在 `enterFullscreen` 成功返回 `isFullscreen: true` 时记录有效状态。离开视图时仅撤销由本视图发起的全屏，进入前已处于全屏状态的保持不变
 * 命令执行失败或处于无宿主开发环境时正常停留在视图内，不视作异常
 * 视图发起的全屏若被宿主外部行为退出（例如用户触发全局快捷键），自动联动退出当前视图，且不再重复派发退出全屏指令
 *
 * `window:stateChanged` 事件广播至所有窗口，此处仅过滤并处理当前窗口事件。窗口 ID 经 `getCurrentWindowId` 获取之前，按主窗口 `main` 处理
 *
 * 同一时刻仅允许单一外壳实例与宿主交互：启动时请求进入全屏推迟至微任务执行，派发前若外壳已释放则取消派发
 * （避免开发环境 React 严格模式重复挂载卸载导致派发多余指令）。已释放的外壳若收到进入全屏的成功响应，
 * 且当前视图已创建新外壳实例，则将状态交接给新外壳，避免发送退出指令
 */

/** 指针与键盘均处于闲置状态达到该阈值（毫秒）后隐藏控件层与光标。产生指针移动或按键输入时立即唤出 */
export const IDLE_HIDE_MS = 3000;

/** 外壳所依赖的宿主接口，类型定义取自 SDK 的 `fb` */
export interface ImmersiveHost {
  isAvailable: typeof fb.isAvailable;
  on: typeof fb.on;
  ui: Pick<
    typeof fb.ui,
    'enterFullscreen' | 'exitFullscreen' | 'isFullscreen' | 'getCurrentWindowId'
  >;
}

/** 窗口 ID 获取完成前默认匹配主窗口：沉浸视图仅在主窗口中运行 */
const MAIN_WINDOW_ID = 'main';

/** 延迟指定毫秒后执行回调，返回取消函数 */
export type Schedule = (run: () => void, ms: number) => () => void;

export interface ImmersiveShellDeps {
  history: Pick<NavHistoryService, 'back' | 'navigate'>;
  /** 进入视图时是否请求宿主主窗口同步全屏。初始化时读取一次 */
  fullscreenOnEnter: () => boolean;
  /** 迷你窗口保存与恢复期间全屏状态由其接管，不据此后退或重新进入全屏 */
  fullscreenManaged?: () => boolean;
  /** 视图隐藏时暂停控件层计时，保留全屏状态记录。未传入时视为始终可见 */
  active?: Atom<boolean>;
  /** 为真时阻止控件层与光标自动隐藏：浏览面板处于展开态时交互均在面板内进行，需保持入口按钮可见。变为假时重置计时 */
  hold?: Atom<boolean>;
  host?: ImmersiveHost;
  /** 闲置计时调度器，默认使用 `setTimeout` */
  schedule?: Schedule;
}

export interface ImmersiveShell {
  /** 当前视图仍为活动地点且外壳未释放。按键命令据此判定是否响应 */
  current(): boolean;
  /** 接收到指针移动或按键事件：恢复控件层与光标显示，并重置闲置计时 */
  touch(): void;
  /** 视图全屏切换按钮：当前全屏则退出，否则进入。宿主不可用或不支持全屏时忽略 */
  toggleFullscreen(): Promise<void>;
  /**
   * 退出沉浸视图，供 Esc 键与右上角 Esc 胶囊按钮调用：优先撤销本视图发起的全屏再执行后退，
   * 没有可后退的记录（此前的记录已被历史上限挤掉）时导航至 `START_PLACE`
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

/** 控件层与光标当前的可见状态 */
export const controlsVisibleAtom: Atom<boolean> = atom((get) => get(stateAtom).controlsVisible);
/** 宿主主窗口当前的全屏状态。null 表示未知或不支持，视图全屏按钮隐藏。仅在外壳激活期间跟踪宿主 */
export const hostFullscreenAtom: Atom<boolean | null> = atom(
  (get) => get(stateAtom).hostFullscreen,
);

const browserSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** 当前正在与宿主交互的外壳实例。已释放外壳收到的全屏响应交接予该实例 */
let liveShell: { adopt(): void } | null = null;

export function startImmersiveShell(store: Store, deps: ImmersiveShellDeps): ImmersiveShell {
  const { history, host = fb, schedule = browserSchedule } = deps;
  const own = store.get(mainHistoryAtom).entry;
  store.set(stateAtom, INITIAL);
  let left = false;
  // 仅在确认由当前视图触发宿主全屏时置为真：离开时据此决定是否派发 exitFullscreen
  let entered = false;
  // 全屏状态写入计数器：用于丢弃晚于事件或命令响应到达的 isFullscreen 初始读取结果
  let fullscreenWrites = 0;
  let cancelIdle: (() => void) | undefined;
  let offState: (() => void) | undefined;
  let windowId = MAIN_WINDOW_ID;
  const self = {
    // 已释放的外壳成功触发宿主全屏：当前视图仍然打开时，将全屏状态记录移交当前外壳
    adopt(): void {
      if (left) return;
      entered = true;
      setFullscreen(true);
    },
  };
  liveShell = self;

  // 离开视图后忽略更新：新视图可能已启动自身外壳并共享状态原子
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
    cancelIdle = undefined;
    if (left || (deps.active && !store.get(deps.active)) || (deps.hold && store.get(deps.hold))) {
      return;
    }
    cancelIdle = schedule(() => {
      cancelIdle = undefined;
      update({ controlsVisible: false });
    }, IDLE_HIDE_MS);
  }

  // 执行失败仅可能由于原本未处于全屏（宿主返回 OPERATION_FAILED）或宿主不可用，无需额外处理
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
    offActive?.();
    offHold?.();
    if (!entered) return;
    entered = false;
    exitHostFullscreen();
  }

  function onStateChanged(payload: WindowStateChangedPayload): void {
    if (left || payload.windowId !== windowId) return;
    const { isFullscreen } = payload;
    setFullscreen(isFullscreen);
    // 由本视图请求的全屏被宿主外部行为退出：已脱离全屏，直接后退且不再派发 exitFullscreen
    if (entered && !isFullscreen && !deps.fullscreenManaged?.()) {
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
    if (left || deps.fullscreenManaged?.()) return;
    const answer = await settle(() => host.ui.enterFullscreen());
    if (answer === null || !answer.success || !answer.isFullscreen) return;
    if (!left) {
      self.adopt();
      return;
    }
    // 等待响应期间已离开视图：若存在新外壳实例则移交管理，否则补发退出全屏以恢复主窗口状态
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

  const offHistory = store.sub(mainHistoryAtom, () => {
    if (store.get(mainHistoryAtom).entry !== own) depart();
  });
  const offActive = deps.active
    ? store.sub(deps.active, () => {
        update({ controlsVisible: true });
        armIdle();
      })
    : undefined;
  const offHold = deps.hold
    ? store.sub(deps.hold, () => {
        update({ controlsVisible: true });
        armIdle();
      })
    : undefined;

  armIdle();
  // 宿主未连接时 SDK 方法约等待 100ms 返回 NOT_SUPPORTED：跳过查询且不显示全屏切换按钮
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
      if (left || deps.fullscreenManaged?.()) return;
      const fullscreen = store.get(stateAtom).hostFullscreen;
      if (fullscreen === null) return;
      if (!fullscreen) {
        await requestFullscreen();
        return;
      }
      // 主动调用退出全屏不视为宿主侧外部退出：提前清除记录，避免随后的 stateChanged 事件连带触发导航后退
      entered = false;
      const answer = await settle(() => host.ui.exitFullscreen());
      // 退出失败则保持全屏状态，等待后续 stateChanged 事件校准
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
