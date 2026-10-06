import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { RIGHT_CARD_WIDTH } from './rightCard.ts';
import { useRightCard } from './rightCardContext.ts';
import styles from './RightCardSplitter.module.css';

/** 拖拽条的命中区宽，CSS 像素，就是内容卡与右侧卡之间那条缝。 */
export const GUTTER = 8;

/** 方向键一下改多少宽，CSS 像素。 */
const KEY_STEP = 16;

export interface RightCardSplitterProps {
  /** 内容卡与右侧卡所在的那一层：它的右缘减去指针位置、再减去半条缝，就是卡的宽度。 */
  readonly dock: RefObject<HTMLElement | null>;
}

/**
 * 内容卡与右侧卡之间的拖拽条（WAI-ARIA separator），做法同侧边栏的分栏握柄：整条缝都是命中区，握柄悬停、
 * 聚焦、拖动时才显示。拖动中每一下都落盘，按 Esc 回到拖动之前的宽度；双击回到缺省宽度。焦点在它上面时
 * ← 加宽、→ 收窄。卡的宽度存的是用户拖到的值，内容卡不够宽时卡在版式里让宽，存的不变。
 */
export function RightCardSplitter({ dock }: RightCardSplitterProps) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const { card } = useRightCard();
  const { width } = useAtomValueRawSync(card.view).prefs;
  const handle = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const finish = useRef<(() => void) | null>(null);

  useLayoutEffect(() => () => finish.current?.(), []);

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || finish.current) return;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const right = dock.current?.getBoundingClientRect().right ?? 0;
    const rest = store.get(card.view).prefs.width;
    event.preventDefault();
    element.setPointerCapture(pointerId);
    const move = (moved: globalThis.PointerEvent) => {
      card.setWidth(right - moved.clientX - GUTTER / 2);
    };
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      cancel.current = null;
      finish.current = null;
      setDragging(false);
    };
    cancel.current = () => {
      card.setWidth(rest);
      end();
    };
    finish.current = end;
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
    setDragging(true);
  };

  useCommand({
    id: 'rightCard.cancelResize',
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => cancel.current !== null,
    run: () => cancel.current?.(),
  });
  const resizeKey = (key: string, step: number) => ({
    id: `rightCard.resize.${key}`,
    layer: 'widget' as const,
    keys: [{ key }],
    enabled: () => document.activeElement === handle.current,
    run: () => card.setWidth(store.get(card.view).prefs.width + step),
  });
  useCommand(resizeKey('ArrowLeft', KEY_STEP));
  useCommand(resizeKey('ArrowRight', -KEY_STEP));

  return (
    <div
      ref={handle}
      className={styles.splitter}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t('rightCard.resize')}
      aria-valuenow={width}
      aria-valuemin={RIGHT_CARD_WIDTH.min}
      aria-valuemax={RIGHT_CARD_WIDTH.max}
      data-dragging={dragging || undefined}
      onPointerDown={press}
      onDoubleClick={() => card.setWidth(RIGHT_CARD_WIDTH.initial)}
    >
      <span className={styles.grip} />
    </div>
  );
}
