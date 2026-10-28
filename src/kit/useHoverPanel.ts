import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface HoverPanelOptions {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly trigger: string;
  readonly panel: RefObject<HTMLElement | null>;
  held?(): boolean;
  onOpen(trigger: Element): void;
  onClose(): void;
}

/** 悬停触发展开的延迟防抖时间（毫秒） */
const OPEN_MS = 300;
/** 指针移出触发区与面板后的关闭宽限时长（毫秒） */
const CLOSE_MS = 500;

/**
 * 悬停浮层展示状态管理的 Hook
 * 触发入口与浮层面板共用移出关闭宽限；利用 React 事件冒泡树管理焦点与指针状态，可覆盖通过 Portal 挂载的子浮层
 */
export function useHoverPanel(options: HoverPanelOptions) {
  const latest = useRef(options);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inside = useRef(false);
  const focused = useRef(false);
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    clear();
    if (!options.open) focused.current = false;
    return clear;
  }, [clear, options.enabled, options.open]);

  const leave = useCallback(() => {
    inside.current = false;
    clear();
    if (!latest.current.open || focused.current) return;
    timer.current = setTimeout(() => {
      if (
        !inside.current &&
        !focused.current &&
        latest.current.open &&
        !latest.current.held?.() &&
        !latest.current.panel.current?.contains(document.activeElement)
      )
        latest.current.onClose();
    }, CLOSE_MS);
  }, [clear]);

  useEffect(() => {
    if (!options.enabled) return;
    const triggerOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest(options.trigger) : null;
    const enter = (event: PointerEvent) => {
      const trigger = triggerOf(event.target);
      if (!trigger || trigger === triggerOf(event.relatedTarget) || event.pointerType === 'touch')
        return;
      if (event.buttons !== 0) return;
      inside.current = true;
      clear();
      timer.current = setTimeout(() => {
        if (latest.current.enabled && trigger.isConnected) latest.current.onOpen(trigger);
      }, OPEN_MS);
    };
    const exit = (event: PointerEvent) => {
      const trigger = triggerOf(event.target);
      if (!trigger || trigger === triggerOf(event.relatedTarget)) return;
      if (
        event.relatedTarget instanceof Node &&
        latest.current.panel.current?.contains(event.relatedTarget)
      ) {
        inside.current = true;
        clear();
      } else leave();
    };
    // 入口随播放栏位置切换而重挂，委托监听避免持有已经卸载的按钮
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', exit);
    return () => {
      clear();
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', exit);
    };
  }, [clear, leave, options.enabled, options.trigger]);

  return {
    onPointerEnter: () => {
      inside.current = true;
      clear();
    },
    onPointerLeave: leave,
    onFocusCapture: () => {
      focused.current = true;
      clear();
    },
    onBlurCapture: () => {
      focused.current = false;
      if (!inside.current) leave();
    },
  };
}
