import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { useStore } from 'jotai/react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { DURATION_MS, motionDuration } from '../../motion/timing.ts';
import { focusColumn, gapOf, headerCells } from './columnCells.ts';
import type { ColumnGhostState } from './ColumnGhost.tsx';
import { createColumnMotion } from './columnMotion.ts';
import { dropTarget, insideHeader, type ColumnRect, type DropTarget } from './columnPreview.ts';
import { insertColumn, type ColumnId } from './columns.ts';
import type { ColumnsModel } from './columnsModel.ts';

/** 按下后指针挪过这么多 CSS 像素才算拖动；不到就是一次单击（排序）。 */
const DRAG_THRESHOLD = 5;

export interface ColumnReorder {
  /** 正在拖的列；拖动状态挂在这一列自己的列头格上。 */
  readonly dragging: ColumnId | null;
  readonly ghost: ColumnGhostState | null;
  /** 在一次按下到松开之间（含还没过阈值时）。 */
  active(): boolean;
  /** 列头格上的 pointerdown。只接鼠标左键，封面不能拖。 */
  onPointerDown(event: ReactPointerEvent<HTMLElement>, id: ColumnId): void;
  /** 拖过之后浏览器照样补一次 click；答真时这次点击不当排序。键盘点出来的 click 不吞。 */
  swallowClick(event: Pick<MouseEvent, 'detail'>): boolean;
  /** 取消：各列滑回原位，不改列序。 */
  cancel(): void;
}

/**
 * 拖列头换列：过了阈值才捕获指针、冻结列宽，途中各列按预演的列序让位，松手时落盘并让各格从屏幕上的位置
 * 滑到新位置。窗口失焦、指针被夺走时取消；窗口缩放时直接撤掉，列宽已经不是按下时量的了。
 */
export function useColumnReorder(
  columns: ColumnsModel,
  root: RefObject<HTMLElement | null>,
  header: RefObject<HTMLElement | null>,
): ColumnReorder {
  const store = useStore();
  const [dragging, setDragging] = useState<ColumnId | null>(null);
  const [ghost, setGhost] = useState<ColumnGhostState | null>(null);
  const session = useRef<((commit: boolean, immediate: boolean) => void) | null>(null);
  const swallow = useRef(false);
  /** 等真正松手再清 `swallow` 的那个 window 监听，卸载时摘掉。 */
  const release = useRef<(() => void) | null>(null);
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [motion] = useState(() =>
    createColumnMotion(
      () => root.current,
      () => headerCells(header.current),
      () => motionDuration(DURATION_MS.fast, store.get(reducedMotionAtom)),
    ),
  );

  const fadeGhost = useCallback(() => {
    clearTimeout(ghostTimer.current);
    setGhost((last) => (last ? { ...last, leaving: true } : null));
    const fade = motionDuration(DURATION_MS.faster, store.get(reducedMotionAtom));
    ghostTimer.current = setTimeout(() => setGhost(null), fade);
  }, [store]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: ColumnId) => {
      const row = header.current;
      if (event.button !== 0 || event.pointerType !== 'mouse' || id === 'cover' || !row) return;
      session.current?.(false, true);
      // 上一轮换完还在淡出的列名作废，不然它的定时器会把这一轮刚出来的列名收掉。
      clearTimeout(ghostTimer.current);
      const cell = event.currentTarget;
      const pointer = event.pointerId;
      const start = { x: event.clientX, y: event.clientY };
      const base = [...store.get(columns.state).order];
      const area = row.getBoundingClientRect();
      let rects: ColumnRect[] = [];
      let moved = false;
      let target: DropTarget | null = null;
      swallow.current = false;

      const update = (x: number, y: number) => {
        setGhost({ id, x, y, leaving: false });
        target = insideHeader(rects, area, x, y) ? dropTarget(rects, id, x) : null;
        motion.preview(target ? insertColumn(base, id, target.id, target.after) : base);
      };
      const move = (next: PointerEvent) => {
        if (next.pointerId !== pointer) return;
        if (!moved) {
          if (Math.hypot(next.clientX - start.x, next.clientY - start.y) <= DRAG_THRESHOLD) return;
          moved = true;
          cell.setPointerCapture(pointer);
          rects = motion.begin(headerCells(row), store.get(columns.layout).header, gapOf(row));
          setDragging(id);
        }
        next.preventDefault();
        update(next.clientX, next.clientY);
      };
      const finish = (commit: boolean, immediate: boolean, released = false) => {
        if (session.current !== finish) return;
        session.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancelled);
        window.removeEventListener('blur', blurred);
        window.removeEventListener('resize', resized);
        cell.removeEventListener('lostpointercapture', lost);
        if (cell.hasPointerCapture(pointer)) cell.releasePointerCapture(pointer);
        setDragging(null);
        if (!moved) return;
        // 拖过之后浏览器在松手时补的那一下 click 不当排序；它没落到按钮上时，松手后的下一轮就清掉，不误吞后来的
        // 点击。Esc、丢了指针捕获这类在松手之前就结束的，要等到真的松手：指针捕获已经放掉，回到原处松手时这一下
        // 会落在列头的按钮上。
        swallow.current = true;
        const clear = () => {
          if (release.current === clear) release.current = null;
          setTimeout(() => {
            swallow.current = false;
          }, 0);
        };
        if (released) clear();
        else {
          release.current = clear;
          window.addEventListener('pointerup', clear, { once: true });
        }
        if (immediate) {
          motion.clear();
          setGhost(null);
          return;
        }
        const drop = commit ? target : null;
        motion.settle(
          drop
            ? () => {
                // 往右换位时 React 挪的是被拖的这一格，里面拿着的焦点跟着丢到 body；挪完还给它。
                const focused = cell.contains(document.activeElement);
                flushSync(() => columns.moveColumn(id, drop.id, drop.after));
                if (focused && !cell.contains(document.activeElement)) focusColumn(row, id);
                return store.get(columns.layout).header;
              }
            : undefined,
        );
        fadeGhost();
      };
      function up(next: PointerEvent) {
        if (next.pointerId !== pointer) return;
        if (moved) update(next.clientX, next.clientY);
        finish(true, false, true);
      }
      function cancelled(next: PointerEvent) {
        if (next.pointerId === pointer) finish(false, false);
      }
      function lost() {
        finish(false, false);
      }
      // 窗口失焦时多半在窗口外松手，等不到那一下 pointerup：当作已经松手。
      function blurred() {
        finish(false, false, true);
      }
      function resized() {
        finish(false, true);
      }
      session.current = finish;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancelled);
      window.addEventListener('blur', blurred);
      window.addEventListener('resize', resized);
      cell.addEventListener('lostpointercapture', lost);
    },
    [columns, header, motion, store, fadeGhost],
  );

  useEffect(
    () => () => {
      session.current?.(false, true);
      if (release.current) window.removeEventListener('pointerup', release.current);
      release.current = null;
      motion.clear();
      clearTimeout(ghostTimer.current);
    },
    [motion],
  );

  return {
    dragging,
    ghost,
    active: () => session.current !== null,
    onPointerDown,
    swallowClick(event) {
      // 键盘（回车、空格）点出来的 click 的 detail 是 0，不是拖动补的那一下。
      if (event.detail === 0) return false;
      const swallowed = swallow.current;
      swallow.current = false;
      return swallowed;
    },
    cancel: () => session.current?.(false, false),
  };
}
