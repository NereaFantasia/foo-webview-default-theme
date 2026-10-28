import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from './hostCall.ts';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 窗口原生外壳交互接口：涵盖宿主连接状态、窗口尺寸状态（最大化/最小化/前台激活）、
 * 窗口控制三键命令，以及标题栏几何尺寸同步
 *
 * 注：原生拖拽判定优先由 WebView2 非客户区命中测试根据 CSS `app-region: drag` 进行分发；
 * 标题栏高度仅作为宿主非客户区判定未命中时的回退兜底
 */
export interface WindowShellFace extends HostReadyFace {
  on: typeof fb.on;
  ui: Pick<
    typeof fb.ui,
    | 'getState'
    | 'minimize'
    | 'toggleMaximize'
    | 'close'
    | 'setTitlebarHeight'
    | 'setMaximizeButtonRegion'
  >;
}

export interface WindowShellState {
  /** 宿主 Bridge 连接状态（仅记录当前初始化周期的连接结果） */
  readonly status: 'connecting' | 'connected' | 'disconnected';
  readonly maximized: boolean;
  /** 最小化状态；若为 null 表示尚未取得快照或快照已失效，不可作为资源调度依据 */
  readonly minimized: boolean | null;
  /** 窗口是否处于前台激活状态；初次读得之前默认假定为前台活跃 */
  readonly active: boolean;
  /**
   * 指示系统是否已接管最大化键并支持贴靠布局菜单（Windows 11 Snap Layouts）
   * 为 true 时最大化按钮禁用自定义 Tooltip，避免遮挡原生贴靠浮层；仅以宿主最新上报确认为准
   */
  readonly snapLayouts: boolean;
}

/** 最大化按钮在 Web 页面视口内的几何包围盒（CSS 像素，以页面左上角为原点） */
export interface ButtonRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const INITIAL: WindowShellState = {
  status: 'connecting',
  maximized: false,
  minimized: null,
  active: true,
  snapLayouts: false,
};
const stateAtom = atom<WindowShellState>(INITIAL);

export const windowShellAtom: Atom<WindowShellState> = atom((get) => get(stateAtom));

/** `window.setTitlebarHeight` 收的范围，物理像素；越界宿主答失败，这里先挡住 */
export const TITLEBAR_HEIGHT_RANGE = { min: 24, max: 100 } as const;

export interface WindowShellService {
  readonly ready: Promise<void>;
  /** 恢复时先使旧活动快照失效，再回读当前窗口；失败时不恢复旧快照 */
  refreshState(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  /**
   * 标题栏渲染后量到的高度，CSS 像素。宿主拿它与物理像素的客户区坐标直接比，这里乘上设备像素比再发；
   * 同值不重发，DPI 变了（宿主会按缺省值重算自己的高度）再补发一次
   */
  setTitlebarHeight(cssPixels: number): void;
  /**
   * 最大化键此刻的矩形，布局一变就报。宿主按 CSS 像素收、自己乘缩放，页面重载与 DPI 变化时它会忘掉
   * 矩形，DPI 变了这里补报一次。同一矩形不重发；宿主拒收的那个矩形也不再发，等矩形变了才再试
   */
  setMaximizeButtonRegion(rect: ButtonRect): void;
  /**
   * 整窗盖住标题栏的视图（沉浸视图）开着时置真：撤掉已报的最大化键矩形，悬停右上角不再弹出贴靠布局压在视图上；
   * 置假时补报当前矩形。只管是否向宿主报，标题栏自己照常量、照常上报给 `setMaximizeButtonRegion`
   */
  coverMaximizeButton(covered: boolean): void;
  dispose(): void;
}

/** 宿主丢掉小数再乘缩放；这里先取整，比较与发出去的是同一组数 */
function truncRect(rect: ButtonRect): ButtonRect {
  return {
    x: Math.trunc(rect.x),
    y: Math.trunc(rect.y),
    width: Math.trunc(rect.width),
    height: Math.trunc(rect.height),
  };
}

const rectKey = (rect: ButtonRect) => `${rect.x},${rect.y},${rect.width},${rect.height}`;
/** `regionSent` 的取值之一：最近发的是「撤掉矩形」 */
const REGION_REMOVED = 'removed';

export function startWindowShell(
  store: Store,
  host: WindowShellFace = fb,
  pixelRatio: () => number = () => globalThis.devicePixelRatio || 1,
): WindowShellService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let reads = 0;
  let measured = 0;
  let applied = 0;
  let region: ButtonRect | null = null;
  // 最近一次发出的矩形；失败了也留着它，同一个矩形就不会再发
  let regionSent = '';
  let regionSends = 0;
  let covered = false;
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);

  const update = (patch: Partial<WindowShellState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };
  const connected = () => !disposed && store.get(stateAtom).status === 'connected';

  // 连着来的几次重读只认最后一次；单次读失败不说明宿主断了，保留上次的状态
  async function readState(invalidate = false): Promise<void> {
    if (!connected()) return;
    const mine = ++reads;
    if (invalidate || !host.isAvailable()) update({ minimized: null });
    if (!host.isAvailable()) return;
    const answer = await settle(() => host.ui.getState());
    if (disposed || mine !== reads) return;
    if (!host.isAvailable()) {
      update({ minimized: null });
      return;
    }
    if (!answer || answer.success === false) return;
    update({ maximized: answer.maximized, active: answer.focused, minimized: answer.minimized });
  }

  function sendHeight(): void {
    const physical = Math.round(measured * pixelRatio());
    if (!connected() || physical === applied) return;
    if (physical < TITLEBAR_HEIGHT_RANGE.min || physical > TITLEBAR_HEIGHT_RANGE.max) return;
    applied = physical;
    void hostCommand(() => host.ui.setTitlebarHeight(physical)).then((ok) => {
      if (!ok && applied === physical) applied = 0;
    });
  }

  // 矩形是整体替换的，宿主按收到的先后生效；应答只认最后发出的那一次。盖住标题栏时不带参数调一次，撤掉矩形
  function sendRegion(): void {
    if (!connected()) return;
    if (covered) {
      if (regionSent === REGION_REMOVED) return;
      regionSent = REGION_REMOVED;
      const removing = ++regionSends;
      void settle(() => host.ui.setMaximizeButtonRegion()).then((answer) => {
        if (disposed || removing !== regionSends || !answer || answer.success === false) return;
        update({ snapLayouts: answer.hasRegion && answer.snapLayouts });
      });
      return;
    }
    if (!region || rectKey(region) === regionSent) return;
    const rect = region;
    regionSent = rectKey(rect);
    const mine = ++regionSends;
    void settle(() => host.ui.setMaximizeButtonRegion(rect)).then((answer) => {
      if (disposed || mine !== regionSends || !answer || answer.success === false) return;
      update({ snapLayouts: answer.hasRegion && answer.snapLayouts });
    });
  }

  /** 命令不做乐观更新：执行后回读，成功与否都以宿主为准 */
  async function command(call: () => Promise<{ success: boolean }>): Promise<void> {
    if (!connected()) return;
    await hostCommand(call);
    await readState();
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      update({ status: 'disconnected' });
      return;
    }
    // 先订阅再初读。这个事件广播给所有窗口，只当重读的信号、不看载荷：重读的总是自己这个窗口，
    // 别的窗口变了也只是多读一次
    offs.push(
      host.on('window:stateChanged', () => void readState()),
      host.on('window:dpiChanged', () => {
        applied = 0;
        regionSent = '';
        sendHeight();
        sendRegion();
      }),
    );
    update({ status: 'connected' });
    sendHeight();
    sendRegion();
    await readState();
  }

  return {
    ready: connect(),
    refreshState: () => readState(true),
    minimize: () => command(() => host.ui.minimize()),
    toggleMaximize: () => command(() => host.ui.toggleMaximize()),
    close: () => command(() => host.ui.close()),
    setTitlebarHeight(cssPixels) {
      measured = cssPixels;
      sendHeight();
    },
    setMaximizeButtonRegion(rect) {
      region = truncRect(rect);
      sendRegion();
    },
    coverMaximizeButton(next) {
      if (covered === next) return;
      covered = next;
      // 撤掉之后再盖回来要补报，同一个矩形也不能当作已发过
      if (!next) regionSent = '';
      sendRegion();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      waiter.cancel();
      for (const off of offs.splice(0)) off();
      store.set(stateAtom, { ...store.get(stateAtom), minimized: null });
    },
  };
}

export const windowShellKey = serviceKey<WindowShellService>('windowShell');
