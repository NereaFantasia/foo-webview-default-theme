import type { ButtonInput, InputTarget, KeyInput } from '../../src/nav/commandRegistry.ts';

// 单测跑在 Node 里、没有 DOM：这里是只够焦点与按键用的一小棵元素树。元素按选择器列表认 `closest`，
// 事件按捕获（自上而下）、冒泡（自下而上）走一遍祖先链，按键最后交给挂在 `window` 上的监听，
// 与浏览器里元素上的监听先于窗口上的登记处收到同一次按键一致。

type Listener = (event: FakeEvent) => void;

/**
 * 替身里的一次事件。登记处挂在窗口上的键盘与鼠标键监听收同一种对象，所以按键事件也带 `button`
 * （恒为 -1，没有鼠标键）。
 */
export interface FakeEvent extends KeyInput, ButtonInput {
  readonly type: string;
  readonly repeat: boolean;
}

export interface PressOptions {
  readonly repeat?: boolean;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export class FakeElement {
  isConnected = true;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly parentElement: FakeElement | null,
    /** 这个元素匹配的简单选择器，如 `button`、`[role="slider"]`。 */
    private readonly selectors: readonly string[],
  ) {}

  /** 在它下面加一个子元素。 */
  append(...selectors: string[]): FakeElement {
    return new FakeElement(this.ownerDocument, this, selectors);
  }

  closest(selectors: string): FakeElement | null {
    const wanted = selectors.split(',').map((one) => one.trim());
    if (this.selectors.some((one) => wanted.includes(one))) return this;
    return this.parentElement?.closest(selectors) ?? null;
  }

  /** 拿到焦点：先改 `activeElement`，再派发 focusin，与浏览器的先后一致。 */
  focus(): void {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.dispatch(this, event('focusin', ''));
  }

  addEventListener(type: string, listener: Listener, capture = false): void {
    const slot = `${type}:${capture}`;
    this.listeners.set(slot, (this.listeners.get(slot) ?? new Set()).add(listener));
  }

  removeEventListener(type: string, listener: Listener, capture = false): void {
    this.listeners.get(`${type}:${capture}`)?.delete(listener);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }

  fire(event: FakeEvent, capture: boolean): void {
    for (const listener of [...(this.listeners.get(`${event.type}:${capture}`) ?? [])]) {
      listener(event);
    }
  }
}

function event(type: string, key: string, options: PressOptions = {}): FakeEvent {
  const created = {
    type,
    key,
    button: -1,
    repeat: options.repeat ?? false,
    altKey: options.alt ?? false,
    ctrlKey: options.ctrl ?? false,
    shiftKey: options.shift ?? false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {
      created.defaultPrevented = true;
    },
  };
  return created;
}

export class FakeDocument {
  readonly body: FakeElement;
  activeElement: FakeElement | null;
  /** 登记处挂监听的对象，页面里是 `window`；只收 keydown。 */
  readonly window: InputTarget;
  private readonly keyListeners = new Set<(event: KeyInput & ButtonInput) => void>();

  constructor() {
    this.body = new FakeElement(this, null, ['body']);
    this.activeElement = this.body;
    const keyListeners = this.keyListeners;
    this.window = {
      addEventListener(type: string, listener: (event: KeyInput & ButtonInput) => void) {
        if (type === 'keydown') keyListeners.add(listener);
      },
      removeEventListener(type: string, listener: (event: KeyInput & ButtonInput) => void) {
        if (type === 'keydown') keyListeners.delete(listener);
      },
    };
  }

  /** 按一个键：从焦点所在的元素派发，最后交给窗口上的监听。返回事件，看有没有被拦下缺省。 */
  press(key: string, options: PressOptions = {}): FakeEvent {
    const pressed = event('keydown', key, options);
    this.dispatch(this.activeElement ?? this.body, pressed);
    for (const listener of [...this.keyListeners]) listener(pressed);
    return pressed;
  }

  /** 用指针点一下：按下、（还没有焦点就）聚焦、抬起。 */
  click(element: FakeElement): void {
    this.dispatch(element, event('pointerdown', ''));
    if (this.activeElement !== element) element.focus();
    this.dispatch(element, event('pointerup', ''));
  }

  /** 焦点丢到 body 上，例如拿着焦点的元素被移走了；浏览器这时不派发 focusin。 */
  dropFocus(): void {
    this.activeElement = this.body;
  }

  dispatch(target: FakeElement, fired: FakeEvent): void {
    const path: FakeElement[] = [];
    for (let node: FakeElement | null = target; node; node = node.parentElement) path.push(node);
    for (const node of [...path].reverse()) node.fire(fired, true);
    for (const node of path) node.fire(fired, false);
  }
}
