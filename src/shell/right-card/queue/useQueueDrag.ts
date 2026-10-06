import { useId, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useCommand } from '../../../nav/useCommand.ts';
import type { QueueListRow } from './useQueueList.ts';

/** 按下后挪过这么多才算拖，CSS 像素；挪得少是单击。 */
const DRAG_SLOP = 4;
/** 视口边缘的滚动感应宽度（CSS 像素）与最高速度（CSS 像素／秒）。 */
const SCROLL_EDGE = 40;
const SCROLL_SPEED = 720;

export interface QueueDragState {
  /** 正被拖着的几行。 */
  readonly lifted: ReadonlySet<string>;
  /** 落点线离列表上缘的 CSS 像素；null 表示指针在有效落区之外。 */
  readonly lineY: number | null;
  /** 副本左上角的视口坐标，保留按下时的抓取偏移，单位为 CSS 像素。 */
  readonly ghostX: number;
  readonly ghostY: number;
  readonly width: number;
  /** 提起的那一行，画副本用。 */
  readonly grabbed: QueueListRow;
}

export interface QueueDragOptions {
  /** 「队列」段那张列表的根，行按 `data-queue-row` 认。 */
  readonly list: RefObject<HTMLElement | null>;
  readonly queued: readonly QueueListRow[];
  /** 按下的这一行此刻选中的「队列」段行，按列表顺序；没选中它时只拖它一行。 */
  lift(key: string): readonly QueueListRow[];
  /** 松手：这几行挪到 `before` 前面，`before` 为 null 挪到队尾。 */
  drop(keys: readonly string[], before: string | null): void;
  /** 没拖起来就松手：当单击处理。 */
  click(key: string, event: globalThis.PointerEvent): void;
}

interface Slot {
  readonly key: string;
  readonly top: number;
  readonly bottom: number;
}

/** 落点：指针在哪两行之间。答落点线的位置与它下面那一行（没有就是队尾）。 */
function dropSlot(slots: readonly Slot[], y: number): { line: number; before: string | null } {
  for (const slot of slots) {
    if (y < (slot.top + slot.bottom) / 2) return { line: slot.top, before: slot.key };
  }
  const last = slots.at(-1);
  return { line: last ? last.bottom : 0, before: null };
}

/**
 * 「队列」段的拖动排序：按住行或手柄、挪过几像素才提起；提起时连同选中的几行一起走。拖动中落点画一道
 * 主色线，提起的那一行跟着指针；松手后一次提交，落回原处不提交。拖动中按 Esc 放下、不提交。
 */
export function useQueueDrag(options: QueueDragOptions) {
  const [state, setState] = useState<QueueDragState | null>(null);
  const scope = useId();
  const latest = useRef(options);
  const cancel = useRef<(() => void) | null>(null);
  const finish = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useLayoutEffect(() => () => finish.current?.(), []);

  useCommand({
    id: `queue.cancelDrag.${scope}`,
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => cancel.current !== null,
    run: () => cancel.current?.(),
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, key: string) => {
    if (event.button !== 0 || finish.current) return;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const grabbedBox = element.getBoundingClientRect();
    const offsetX = startX - grabbedBox.left;
    const offsetY = startY - grabbedBox.top;
    const root = latest.current.list.current;
    const scroller = root?.closest('[data-queue-page]')?.parentElement;
    const row = latest.current.queued.find((item) => item.key === key);
    let lifted: readonly QueueListRow[] | null = null;
    let target: string | null = null;
    let validDrop = false;
    let pointerX = event.clientX;
    let pointerY = startY;
    let frame = 0;
    let lastTime = 0;
    element.setPointerCapture(pointerId);

    const slotsOf = (keep: ReadonlySet<string>): Slot[] => {
      const base = root?.getBoundingClientRect().top ?? 0;
      return [...(root?.querySelectorAll<HTMLElement>('[data-queue-row]') ?? [])]
        .filter((node) => !keep.has(node.dataset.queueRow ?? ''))
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            key: node.dataset.queueRow ?? '',
            top: box.top - base,
            bottom: box.bottom - base,
          };
        });
    };

    const update = () => {
      if (!row || !lifted || !root || !scroller) return;
      const keys = new Set(lifted.map((item) => item.key));
      const bounds = root.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      validDrop =
        pointerX >= Math.max(bounds.left, viewport.left) &&
        pointerX <= Math.min(bounds.right, viewport.right) &&
        pointerY >= Math.max(bounds.top, viewport.top) &&
        pointerY <= Math.min(bounds.bottom, viewport.bottom);
      const y = pointerY - bounds.top;
      const slot = dropSlot(slotsOf(keys), y);
      target = slot.before;
      setState({
        lifted: keys,
        lineY: validDrop ? slot.line : null,
        ghostX: pointerX - offsetX,
        ghostY: pointerY - offsetY,
        width: grabbedBox.width,
        grabbed: row,
      });
    };
    const scroll = (time: number) => {
      frame = 0;
      if (!lifted || !root || !scroller || !validDrop) return;
      const bounds = scroller.getBoundingClientRect();
      if (pointerX < bounds.left || pointerX > bounds.right) return;
      const edge = Math.min(SCROLL_EDGE, bounds.height / 2);
      const speed =
        pointerY < bounds.top + edge
          ? -Math.min(1, (bounds.top + edge - pointerY) / edge)
          : pointerY > bounds.bottom - edge
            ? Math.min(1, (pointerY - bounds.bottom + edge) / edge)
            : 0;
      const elapsed = lastTime ? Math.min(32, time - lastTime) : 16;
      lastTime = time;
      const before = scroller.scrollTop;
      // 拖动只在手动队列内找落点，不继续滚入后面的来源列表。
      const end = Math.max(0, root.getBoundingClientRect().bottom - bounds.bottom + before);
      scroller.scrollTop = Math.max(
        0,
        Math.min(end, before + (speed * SCROLL_SPEED * elapsed) / 1000),
      );
      if (scroller.scrollTop !== before) {
        update();
        frame = requestAnimationFrame(scroll);
      }
    };
    const move = (moved: globalThis.PointerEvent) => {
      if (!row || moved.pointerId !== pointerId) return;
      pointerX = moved.clientX;
      pointerY = moved.clientY;
      if (!lifted) {
        if (Math.hypot(pointerX - startX, pointerY - startY) < DRAG_SLOP) return;
        lifted = latest.current.lift(key);
      }
      update();
      if (!frame) {
        lastTime = 0;
        frame = requestAnimationFrame(scroll);
      }
    };
    const end = (commit: boolean, released?: globalThis.PointerEvent) => {
      cancelAnimationFrame(frame);
      scroller?.removeEventListener('scroll', update);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', abort);
      element.removeEventListener('lostpointercapture', abort);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      cancel.current = null;
      finish.current = null;
      setState(null);
      if (!lifted) {
        if (commit && released) latest.current.click(key, released);
        return;
      }
      if (commit)
        latest.current.drop(
          lifted.map((item) => item.key),
          target,
        );
    };
    const up = (released: globalThis.PointerEvent) => {
      if (released.pointerId !== pointerId) return;
      pointerX = released.clientX;
      pointerY = released.clientY;
      if (lifted) update();
      end(lifted ? validDrop : true, released);
    };
    const abort = () => end(false);
    cancel.current = abort;
    finish.current = abort;
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', abort);
    element.addEventListener('lostpointercapture', abort);
    scroller?.addEventListener('scroll', update, { passive: true });
  };

  return { drag: state, onPointerDown };
}
