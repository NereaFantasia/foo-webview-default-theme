import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../../host/hostCall.ts';
import { placeBox, readScreen } from '../../host/miniPlacement.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import type { DesktopLyricsMode, DesktopLyricsSizeMemory } from './desktopLyricsPrefs.ts';
import {
  DESKTOP_LYRICS_LINES_KEY,
  DESKTOP_LYRICS_VIEW_KEY,
  desktopLyricsMessage,
  parseDesktopLyricsLines,
  parseDesktopLyricsMessage,
  parseDesktopLyricsView,
  type DesktopLyricsCommand,
  type DesktopLyricsLines,
  type DesktopLyricsView,
} from './desktopLyricsLink.ts';

export interface DesktopLyricsPopupFace extends HostReadyFace {
  on: typeof fb.on;
  sharedState: Pick<typeof fb.sharedState, 'get'>;
  player: Pick<typeof fb.player, 'prev' | 'toggle' | 'next'>;
  ui: Pick<
    typeof fb.ui,
    | 'sendMessage'
    | 'setClickThrough'
    | 'setClickThroughExcludeRegions'
    | 'clearClickThroughExcludeRegions'
    | 'setResizable'
    | 'setMinSize'
    | 'getBounds'
    | 'setPosition'
    | 'setBounds'
  >;
}

/** 页面里的一块矩形，CSS 像素 */
export interface PopupRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopLyricsPopup {
  readonly view: Atom<DesktopLyricsView | null>;
  readonly lines: Atom<DesktopLyricsLines | null>;
  /** 鼠标在窗口上：穿透时由宿主轮询报，平时由页面自己的指针事件报 */
  readonly hovering: Atom<boolean>;
  send(command: DesktopLyricsCommand): void;
  transport(action: 'prev' | 'toggle' | 'next'): void;
  setPointerInside(inside: boolean): void;
  /** 穿透与否、穿透时仍可点的那块（解锁键）。同样的值不重发 */
  setClickThrough(through: boolean, keep: PopupRect | null): void;
  switchMode(): void;
  beginDrag(): void;
  dragBy(x: number, y: number): void;
  endDrag(): void;
  /** 多行的最小尺寸，也是单行的固定高度，CSS 像素；约束与尺寸串行下发 */
  setLayout(width: number, height: number, singleWidth: number): void;
  dispose(): void;
}

/** 窗口位置隔多久看一次，毫秒。宿主不报窗口移动，只能看页面的屏幕坐标变没变 */
const BOUNDS_POLL_MS = 1000;
/** 移回屏幕时窗口底边离工作区底边，CSS 像素 */
const BOTTOM_GAP = 48;
/** 窗口露在工作区里少于这么多就当看不见，CSS 像素 */
const VISIBLE_MIN = 48;

const rectKey = (rect: PopupRect | null) =>
  rect ? `${rect.x},${rect.y},${rect.width},${rect.height}` : '';

interface PopupLayout {
  readonly mode: DesktopLyricsMode;
  readonly locked: boolean;
  readonly width: number;
  readonly height: number;
  readonly singleWidth: number;
  readonly multilineSize: DesktopLyricsSizeMemory | null;
}

interface PopupDrag {
  origin: { x: number; y: number } | null;
  delta: { x: number; y: number };
  ended: boolean;
  writing: boolean;
}

/**
 * 桌面歌词弹窗自己这一侧：读主窗口写进共享状态的显示参数与歌词（先订阅再初读，晚到的旧值不盖新值），
 * 把命令发给主窗口，按锁定与隐藏设穿透、改尺寸与解锁键的热区，窗口挪动后把位置报给主窗口记下
 */
export function startDesktopLyricsPopup(
  store: Store,
  host: DesktopLyricsPopupFace = fb,
  windowId: string = new URLSearchParams(location.search).get('windowId') ?? '',
): DesktopLyricsPopup {
  const view = atom<DesktopLyricsView | null>(null);
  const lines = atom<DesktopLyricsLines | null>(null);
  const hoverHost = atom(false);
  const hoverPage = atom(false);
  let disposed = false;
  let through: boolean | null = null;
  let keep = '';
  let layout: PopupLayout | null = null;
  let layoutKey = '';
  let applyingLayout = false;
  let sizedMode: DesktopLyricsMode | null = null;
  let drag: PopupDrag | null = null;
  let lastPlace = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  // 共享状态每个键各记一个序号：初读的应答晚于变更事件到达时丢掉初读
  const seen = { view: 0, lines: 0 };
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);
  const ratio = () => globalThis.devicePixelRatio || 1;

  async function moveDrag(current: PopupDrag): Promise<void> {
    const origin = current.origin;
    if (!origin || current.writing || disposed || drag !== current) return;
    current.writing = true;
    try {
      let applied: PopupDrag['delta'] | null = null;
      while (!disposed && drag === current && applied !== current.delta) {
        const delta: PopupDrag['delta'] = current.delta;
        applied = delta;
        if (
          !(await hostCommand(() =>
            host.ui.setPosition(
              Math.round(origin.x + delta.x * ratio()),
              Math.round(origin.y + delta.y * ratio()),
            ),
          ))
        )
          break;
      }
    } finally {
      current.writing = false;
      if (current.ended && drag === current) drag = null;
    }
  }

  async function applyLayout(): Promise<void> {
    if (applyingLayout || disposed) return;
    applyingLayout = true;
    try {
      let attempted: PopupLayout | null = null;
      while (!disposed && layout !== attempted) {
        const next: PopupLayout | null = layout;
        attempted = next;
        if (!next) break;
        const current = () => !disposed && layout === next;
        if (!(await hostCommand(() => host.ui.setResizable(false))) || !current()) continue;
        if (!(await hostCommand(() => host.ui.setMinSize(next.width, next.height))) || !current())
          continue;
        if (next.mode === 'single' || sizedMode === 'single') {
          const bounds = await settle(() => host.ui.getBounds());
          if (!current() || !bounds?.success) continue;
          const screen = readScreen();
          const availableWidth = screen
            ? Math.floor((screen.work.right - screen.work.left - BOTTOM_GAP) * ratio())
            : Infinity;
          const size =
            next.mode === 'single'
              ? {
                  width: Math.min(availableWidth, Math.max(bounds.width, next.singleWidth)),
                  height: next.height,
                }
              : (next.multilineSize ?? { width: bounds.width, height: Math.round(472 * ratio()) });
          const width = Math.max(next.width, size.width);
          const height = Math.max(next.height, size.height);
          const position = screen
            ? placeBox(
                bounds,
                width,
                height,
                { horizontal: 'left', vertical: 'top' },
                screen,
                ratio(),
              )
            : { x: bounds.x, y: bounds.y };
          const ok = await hostCommand(() => host.ui.setBounds({ ...position, width, height }));
          // 尺寸写入完成后即使偏好已变化，也要记住实际写入的模式，下一轮才会正确恢复
          if (ok) sizedMode = next.mode;
          if (!ok || !current()) continue;
        } else sizedMode = next.mode;
        if (next.mode === 'multi' && !next.locked)
          await hostCommand(() => host.ui.setResizable(true));
      }
    } finally {
      applyingLayout = false;
    }
  }

  function apply(key: string, raw: unknown): void {
    if (key === DESKTOP_LYRICS_VIEW_KEY) {
      const next = parseDesktopLyricsView(raw);
      if (next) store.set(view, next);
    } else if (key === DESKTOP_LYRICS_LINES_KEY) {
      const next = parseDesktopLyricsLines(raw);
      // 同一份歌词再交给播放器会冻住当前行的逐字动画，按 id 判重
      if (next && next.id !== store.get(lines)?.id) store.set(lines, next);
    }
  }

  async function read(key: string, slot: keyof typeof seen): Promise<void> {
    const mine = seen[slot];
    const answer = await settle(() => host.sharedState.get(key));
    if (disposed || mine !== seen[slot] || !answer?.success || !answer.exists) return;
    apply(key, answer.value);
  }

  /** 移到所在屏幕的工作区下方居中 */
  function recenter(): void {
    const screen = readScreen();
    if (!screen) return;
    const { work, window: frame } = screen;
    const width = frame.right - frame.left;
    const height = frame.bottom - frame.top;
    const x = work.left + (work.right - work.left - width) / 2;
    const y = work.bottom - height - BOTTOM_GAP;
    void hostCommand(() => host.ui.setPosition(Math.round(x * ratio()), Math.round(y * ratio())));
  }

  /** 屏幕拔掉、分辨率变了时，记下的位置可能整个落在工作区外 */
  function rescueIfLost(): void {
    const screen = readScreen();
    if (!screen) return;
    const { work, window: frame } = screen;
    const overlapX = Math.min(frame.right, work.right) - Math.max(frame.left, work.left);
    const overlapY = Math.min(frame.bottom, work.bottom) - Math.max(frame.top, work.top);
    if (overlapX < VISIBLE_MIN || overlapY < VISIBLE_MIN) recenter();
  }

  async function reportPlace(): Promise<void> {
    if (applyingLayout) return;
    const { screenX, screenY, outerWidth, outerHeight } = globalThis;
    const place = `${screenX},${screenY},${outerWidth},${outerHeight}`;
    if (place === lastPlace) return;
    const first = lastPlace === '';
    const currentLayout = layout;
    lastPlace = place;
    if (first) return;
    const bounds = await settle(() => host.ui.getBounds());
    if (disposed || applyingLayout || currentLayout !== layout || !bounds?.success) return;
    const { x, y, width, height } = bounds;
    send({ type: 'bounds', bounds: { x, y, width, height } });
  }

  function send(command: DesktopLyricsCommand): void {
    if (disposed) return;
    void settle(() => host.ui.sendMessage('main', desktopLyricsMessage(command)));
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed || !arrived) return;
    offs.push(
      host.on('state:changed', ({ key, value }) => {
        if (key === DESKTOP_LYRICS_VIEW_KEY) seen.view += 1;
        else if (key === DESKTOP_LYRICS_LINES_KEY) seen.lines += 1;
        else return;
        apply(key, value);
      }),
      host.on('window:hoverStateChanged', (payload) => {
        if (payload.windowId === windowId) store.set(hoverHost, payload.hovering);
      }),
      host.on('window:message', ({ sourceWindowId, message }) => {
        if (sourceWindowId === 'main' && parseDesktopLyricsMessage(message)?.type === 'recenter')
          recenter();
      }),
    );
    await Promise.all([
      read(DESKTOP_LYRICS_VIEW_KEY, 'view'),
      read(DESKTOP_LYRICS_LINES_KEY, 'lines'),
    ]);
    if (disposed) return;
    rescueIfLost();
    void reportPlace();
    timer = setInterval(() => void reportPlace(), BOUNDS_POLL_MS);
  }
  void connect();

  return {
    view: atom((get) => get(view)),
    lines: atom((get) => get(lines)),
    hovering: atom((get) => get(hoverHost) || get(hoverPage)),
    send,
    transport(action) {
      if (!disposed) void hostCommand(() => host.player[action]());
    },
    setPointerInside(inside) {
      // 穿透时窗口收不到离开的消息，页面这边的进出不可信，只认宿主轮询报的
      if (!through) store.set(hoverPage, inside);
    },
    setClickThrough(next, region) {
      const area = next ? rectKey(region) : '';
      if (disposed || (next === through && area === keep)) return;
      if (next !== through) {
        through = next;
        void hostCommand(() => host.ui.setClickThrough({ enabled: next }));
        store.set(next ? hoverPage : hoverHost, false);
      }
      if (area === keep) return;
      keep = area;
      void hostCommand(() =>
        region && next
          ? host.ui.setClickThroughExcludeRegions({ regions: [region] })
          : host.ui.clearClickThroughExcludeRegions(),
      );
    },
    switchMode() {
      const current = store.get(view);
      if (disposed || !current || current.locked || applyingLayout) return;
      void settle(() => host.ui.getBounds()).then((bounds) => {
        if (
          disposed ||
          applyingLayout ||
          !bounds?.success ||
          store.get(view)?.mode !== current.mode
        )
          return;
        const { x, y, width, height } = bounds;
        send({
          type: 'mode',
          mode: current.mode === 'multi' ? 'single' : 'multi',
          bounds: { x, y, width, height },
        });
      });
    },
    beginDrag() {
      const currentView = store.get(view);
      if (disposed || !currentView || currentView.locked || currentView.hidden) return;
      const current: PopupDrag = {
        origin: null,
        delta: { x: 0, y: 0 },
        ended: false,
        writing: false,
      };
      drag = current;
      void settle(() => host.ui.getBounds()).then((bounds) => {
        if (disposed || drag !== current || !bounds?.success) return;
        current.origin = { x: bounds.x, y: bounds.y };
        void moveDrag(current);
      });
    },
    dragBy(x, y) {
      if (!drag || drag.ended || disposed) return;
      drag.delta = { x, y };
      void moveDrag(drag);
    },
    endDrag() {
      if (!drag) return;
      drag.ended = true;
      void moveDrag(drag);
    },
    setLayout(width, height, singleWidth) {
      const current = store.get(view);
      if (disposed || !current) return;
      const next: PopupLayout = {
        mode: current.mode,
        locked: current.locked,
        width: Math.ceil(width * ratio()),
        height: Math.ceil(height * ratio()),
        singleWidth: Math.ceil(singleWidth * ratio()),
        multilineSize: current.multilineSize,
      };
      const key = JSON.stringify(next);
      if (key === layoutKey) return;
      layoutKey = key;
      drag = null;
      layout = next;
      void applyLayout();
    },
    dispose() {
      disposed = true;
      drag = null;
      waiter.cancel();
      if (timer !== undefined) clearInterval(timer);
      for (const off of offs.splice(0)) off();
    },
  };
}
