import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import { createHoverReveal } from './hoverReveal.ts';

export interface SeekPreview {
  readonly seconds: number;
  readonly fraction: number;
  readonly generation: number;
  readonly keyboard: boolean;
  readonly descriptionId: string;
  readonly anchor: { getBoundingClientRect(): DOMRect };
}

interface PreviewOptions {
  readonly enabled: boolean;
  readonly generation: number;
  readonly duration: number;
  readonly position: number;
  readonly dragging: boolean;
  readonly descriptionId: string;
}

/** 悬停等待从进入时开始；显示后跟随输入，拖动与键盘共用真实目标而非动画位置。 */
export function useSeekPreview(element: RefObject<HTMLElement | null>, options: PreviewOptions) {
  const { enabled, generation, duration, position, dragging } = options;
  const [open, setOpen] = useState(false);
  const [epoch, setEpoch] = useState(generation);
  const [hover, setHover] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const inside = useRef(false);
  const pressing = useRef(false);
  const pointerType = useRef('');
  const wasDragging = useRef(false);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reveal = useMemo(
    () => createHoverReveal({ openMs: 50, closeMs: 100, onChange: setOpen }),
    [],
  );
  const at = (clientX: number) => {
    const box = element.current?.getBoundingClientRect();
    return box?.width ? Math.min(1, Math.max(0, (clientX - box.left) / box.width)) : 0;
  };
  useLayoutEffect(() => {
    setEpoch(generation);
    setHover(null);
    setKeyboard(false);
    inside.current = false;
    reveal.dismiss();
    clearTimeout(touchTimer.current);
  }, [generation, enabled, reveal]);
  useLayoutEffect(() => {
    const node = element.current;
    if (!enabled || !node) return;
    const enter = (event: globalThis.PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const box = node.getBoundingClientRect();
      setHover(box.width ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0);
      inside.current = true;
      reveal.enter();
    };
    const leave = () => {
      inside.current = false;
      reveal.leave();
    };
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    return () => {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
    };
  }, [enabled, element, reveal]);
  useLayoutEffect(() => {
    // 普通进度更新不能重新安排关闭计时，只在拖动状态变化时交接保留理由。
    if (dragging === wasDragging.current) return;
    reveal.hold('drag', dragging);
    if (dragging) reveal.show();
    else if (wasDragging.current && pointerType.current === 'touch') {
      setHover(duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0);
      clearTimeout(touchTimer.current);
      reveal.hold('touch', true);
      touchTimer.current = setTimeout(() => reveal.hold('touch', false), 3000);
    }
    wasDragging.current = dragging;
  }, [dragging, duration, position, reveal]);
  useLayoutEffect(() => {
    const visibility = () => {
      if (!document.hidden) return;
      reveal.dismiss();
      setKeyboard(false);
      setHover(null);
      inside.current = false;
      clearTimeout(touchTimer.current);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      reveal.dispose();
      clearTimeout(touchTimer.current);
    };
  }, [reveal]);

  const fraction = dragging || keyboard ? (duration > 0 ? position / duration : 0) : (hover ?? 0);
  const target: SeekPreview | null =
    enabled && open && epoch === generation && (dragging || keyboard || hover !== null)
      ? {
          seconds: fraction * duration,
          fraction,
          generation,
          keyboard,
          descriptionId: options.descriptionId,
          anchor: {
            getBoundingClientRect() {
              const node = element.current;
              const box = node?.getBoundingClientRect();
              const rail = node
                ?.querySelector('[data-seek-fill]')
                ?.parentElement?.getBoundingClientRect();
              return new DOMRect(
                (box?.left ?? 0) + fraction * (box?.width ?? 0),
                rail?.top ?? box?.top ?? 0,
                0,
                rail?.height ?? 0,
              );
            },
          },
        }
      : null;
  return {
    target,
    key() {
      if (!enabled) return;
      setKeyboard(true);
      reveal.hold('focus', true);
      reveal.show();
    },
    press(event: PointerEvent<HTMLElement>) {
      if (!enabled || event.button !== 0) return;
      pressing.current = true;
      pointerType.current = event.pointerType;
      setKeyboard(false);
      setHover(at(event.clientX));
      reveal.hold('focus', false);
      reveal.show();
      if (event.pointerType === 'touch') {
        clearTimeout(touchTimer.current);
        reveal.hold('touch', true);
        touchTimer.current = setTimeout(() => reveal.hold('touch', false), 3000);
      }
    },
    pressed() {
      pressing.current = false;
    },
    move(event: PointerEvent<HTMLElement>) {
      if (!enabled || event.pointerType === 'touch') return;
      setHover(at(event.clientX));
      setKeyboard(false);
      reveal.hold('focus', false);
      if (!inside.current && !dragging) {
        inside.current = true;
        reveal.enter();
      }
    },
    focus() {
      if (!enabled || pressing.current || !element.current?.matches(':focus-visible')) return;
      setKeyboard(true);
      reveal.hold('focus', true);
      reveal.show();
    },
    blur() {
      setKeyboard(false);
      reveal.hold('focus', false);
    },
  };
}
