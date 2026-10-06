/**
 * 悬停展开的开合时机：指针停够 `openMs` 才展开，离开 `closeMs` 后才收回，其间回来就不收。按住（拖滑条、
 * 键盘焦点在里面、设备列表开着）期间不收；松开时指针已在外面，再等一个 `closeMs`。点一下、聚焦立刻展开；
 * 轻关（点别处、Esc）立刻收回、按住一并清掉。
 */
export interface HoverReveal {
  readonly open: boolean;
  /** 指针进来（只算鼠标与笔；触屏不悬停）。 */
  enter(): void;
  leave(): void;
  /** 立刻展开：点击、触屏点一下、键盘聚焦。 */
  show(): void;
  /** 某个理由按住或放开；任一理由按着就不收。 */
  hold(reason: HoldReason, held: boolean): void;
  /** 立刻收回。 */
  dismiss(): void;
  dispose(): void;
}

/** 拖着滑条、键盘焦点在里面、设备列表开着、触屏点开后还没到收回的时候。 */
export type HoldReason = 'drag' | 'focus' | 'list' | 'touch';

export interface HoverRevealOptions {
  readonly openMs: number;
  readonly closeMs: number;
  onChange(open: boolean): void;
}

export const HOVER_OPEN_MS = 300;
export const HOVER_CLOSE_MS = 500;

export function createHoverReveal(options: HoverRevealOptions): HoverReveal {
  let open = false;
  let inside = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const holds = new Set<HoldReason>();

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const set = (next: boolean) => {
    clear();
    if (next === open) return;
    open = next;
    options.onChange(next);
  };
  const later = (next: boolean, ms: number) => {
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      set(next);
    }, ms);
  };
  const closeIfIdle = () => {
    if (open && !inside && holds.size === 0) later(false, options.closeMs);
  };

  return {
    get open() {
      return open;
    },
    enter() {
      inside = true;
      if (open) clear();
      else later(true, options.openMs);
    },
    leave() {
      inside = false;
      if (open) closeIfIdle();
      else clear();
    },
    show: () => set(true),
    hold(reason, held) {
      if (held) {
        holds.add(reason);
        if (open) clear();
        return;
      }
      holds.delete(reason);
      closeIfIdle();
    },
    dismiss() {
      holds.clear();
      set(false);
    },
    dispose: clear,
  };
}
