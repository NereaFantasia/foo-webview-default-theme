/**
 * 正在播放全屏页的焦点与按键跟踪：焦点落在哪类元素上、是不是指针带来的，这次按键是不是自动重复。
 * 命令登记处的输入里没有这几样，由 `attachImmersiveRoot` 挂在视图根元素上的监听记下；根元素上的监听
 * 先于窗口上的登记处收到同一次按键，`immersiveKeys.ts` 的命令判断能不能用时读到的就是这一次的。
 */

/** 焦点落在哪类元素上：`control` 自己吃方向键与空格，`button` 是键盘聚焦的按钮、只吃空格。 */
export type KeyTarget = 'free' | 'button' | 'control';

const CONTROLS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="slider"]',
  '[role="listbox"]',
].join(',');
const BUTTONS = 'button, [role="button"]';

/** 跟踪用到的元素的几项；浏览器的 `Element` 满足它。 */
export interface KeyElement {
  closest(selectors: string): unknown;
  readonly parentElement: KeyElement | null;
  readonly isConnected: boolean;
  focus?(): void;
}

type RootEventType = 'keydown' | 'pointerdown' | 'pointerup' | 'focusin';

interface RootEvent {
  readonly type: string;
  /** 只有 keydown 带。 */
  readonly repeat?: boolean;
}

/** 视图的根元素；浏览器的 `HTMLElement` 满足它。 */
export interface KeyTrackerRoot extends KeyElement {
  readonly ownerDocument: {
    readonly activeElement: KeyElement | null;
    readonly body: KeyElement | null;
  };
  focus(): void;
  addEventListener(
    type: RootEventType,
    listener: (event: RootEvent) => void,
    capture: boolean,
  ): void;
  removeEventListener(
    type: RootEventType,
    listener: (event: RootEvent) => void,
    capture: boolean,
  ): void;
}

/** `pointerFocused` 是指针按下时拿到焦点的那个元素；焦点在它上面的按钮不算键盘聚焦。 */
export function targetKind(element: KeyElement, pointerFocused: KeyElement | null): KeyTarget {
  if (element.closest(CONTROLS)) return 'control';
  const button = element.closest(BUTTONS);
  return button && button !== pointerFocused ? 'button' : 'free';
}

function within(root: KeyElement, element: KeyElement): boolean {
  for (let node: KeyElement | null = element; node; node = node.parentElement) {
    if (node === root) return true;
  }
  return false;
}

interface Tracking {
  readonly root: KeyTrackerRoot;
  /** 指针按下之后、随后那次聚焦之前为真。 */
  pointing: boolean;
  pointerFocused: KeyElement | null;
  /** 最近一次经过根元素的按键：当时焦点在哪、是不是自动重复。 */
  pressed: { readonly target: KeyElement | null; readonly repeat: boolean } | null;
}

// 同一时刻只有一个视图根元素；退场过渡里新旧两页并存时，后挂上的为准。
let tracking: Tracking | null = null;

/** 此刻焦点落在哪类元素上；在视图外时为 null。没挂根元素时当作焦点在视图里的空白处。 */
export function focusKind(): KeyTarget | null {
  if (!tracking) return 'free';
  const { root } = tracking;
  const { activeElement, body } = root.ownerDocument;
  if (activeElement === null || activeElement === body) return 'free';
  if (!within(root, activeElement)) return null;
  return targetKind(activeElement, tracking.pointerFocused);
}

/**
 * 此刻这次按键是不是自动重复。焦点落回 body 时按键不经过根元素，记下的是上一次的，不作数；
 * 所以这时按下的第一下要调 `reclaimFocus`，后面的重复才认得出。
 */
export function repeating(): boolean {
  const pressed = tracking?.pressed;
  if (!tracking || !pressed) return false;
  return pressed.repeat && pressed.target === tracking.root.ownerDocument.activeElement;
}

/**
 * 焦点落在 body 上（拿着焦点的元素被移走、藏起）时收回根元素，之后的按键又经过根元素。
 * 视图里的按键命令接手时调；焦点在别处时不动。
 */
export function reclaimFocus(): void {
  if (!tracking) return;
  const { activeElement, body } = tracking.root.ownerDocument;
  if (activeElement === null || activeElement === body) tracking.root.focus();
}

/**
 * 挂到视图根元素上，组件在 effect 里调，卸下时调返回的函数。挂上时把焦点收进根元素（Tab 从控件层开始走），
 * 卸下时还给挂上前拿着焦点的那个元素（多半是进这一页的那个键）；焦点这时已被别人移走（回到的那一页
 * 恢复了自己的焦点）就不抢。
 *
 * 指针按下到随后那次聚焦之间亮着 `pointing`，那次聚焦记成指针带来的；之后的聚焦（Tab、脚本）都当键盘带来的。
 * 按在已有焦点的元素上不会再聚焦一次，抬起时把它也记成指针带来的。
 */
export function attachImmersiveRoot(root: KeyTrackerRoot): () => void {
  const doc = root.ownerDocument;
  const before = doc.activeElement;
  const opener = before && before !== doc.body && !within(root, before) ? before : null;
  const mine: Tracking = { root, pointing: false, pointerFocused: null, pressed: null };
  tracking = mine;

  const listeners: readonly [RootEventType, (event: RootEvent) => void][] = [
    [
      'pointerdown',
      () => {
        mine.pointing = true;
      },
    ],
    [
      'focusin',
      () => {
        mine.pointerFocused = mine.pointing ? doc.activeElement : null;
        mine.pointing = false;
      },
    ],
    [
      'pointerup',
      () => {
        if (mine.pointing) mine.pointerFocused = doc.activeElement;
        mine.pointing = false;
      },
    ],
    [
      'keydown',
      (event) => {
        mine.pressed = { target: doc.activeElement, repeat: event.repeat === true };
      },
    ],
  ];
  for (const [type, listener] of listeners) root.addEventListener(type, listener, true);
  root.focus();

  return () => {
    for (const [type, listener] of listeners) root.removeEventListener(type, listener, true);
    if (tracking === mine) tracking = null;
    const active = doc.activeElement;
    const stranded = active === null || active === doc.body || within(root, active);
    if (opener?.isConnected && stranded) opener.focus?.();
  };
}
