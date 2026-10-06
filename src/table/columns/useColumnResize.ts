import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { headerCells } from './columnCells.ts';
import { isColumnId, type ColumnId } from './columns.ts';
import type { ColumnsModel } from './columnsModel.ts';

export interface ColumnResizeDrag {
  /** 正在拖的分隔条属于哪一列；拖动状态挂在那一个手柄自己身上。 */
  readonly resizing: ColumnId | null;
  active(): boolean;
  /** 分隔条上的 pointerdown：只接主键，捕获指针直到松开。 */
  onPointerDown(event: ReactPointerEvent<HTMLElement>, id: ColumnId): void;
  /** 取消：回到按下时的列宽，不落盘。 */
  cancel(): void;
}

/** 按下这一刻列头各格的实测像素宽。 */
function measure(row: HTMLElement | null): Map<ColumnId, number> {
  const widths = new Map<ColumnId, number>();
  for (const cell of headerCells(row)) {
    const id = cell.dataset['columnId'];
    if (isColumnId(id)) widths.set(id, cell.getBoundingClientRect().width);
  }
  return widths;
}

/**
 * 拖分隔条改列宽。位移从按下起算、不累加；松开或指针被夺走时落盘，取消（Esc）时回到按下时的列宽。拖动途中
 * 分隔条被卸掉也等到松手才结束；整个列头卸掉时当场落盘。
 */
export function useColumnResize(
  columns: ColumnsModel,
  header: RefObject<HTMLElement | null>,
): ColumnResizeDrag {
  const [resizing, setResizing] = useState<ColumnId | null>(null);
  const session = useRef<((keep: boolean) => void) | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: ColumnId) => {
      // 分隔条压在列头格上，不能让列头格当成拖动换列的起手。
      event.stopPropagation();
      if (event.button !== 0) return;
      session.current?.(true);
      const drag = columns.beginResize(id, measure(header.current));
      if (!drag) return;
      event.preventDefault();
      const handle = event.currentTarget;
      const pointer = event.pointerId;
      const startX = event.clientX;
      const move = (next: PointerEvent) => {
        if (next.pointerId === pointer) drag.update(next.clientX - startX);
      };
      const end = (next: PointerEvent) => {
        if (next.pointerId === pointer) finish(true);
      };
      const finish = (keep: boolean) => {
        if (session.current !== finish) return;
        session.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        handle.removeEventListener('lostpointercapture', lost);
        if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
        if (keep) drag.commit();
        else drag.cancel();
        setResizing(null);
      };
      // 捕获还在时丢了捕获就算松手；分隔条自己被卸掉（这一列藏了、窄档收掉了）时捕获随之丢掉，事件改送到
      // document，所以指针事件都在 window 上听，松手照样结束。
      function lost() {
        if (handle.isConnected) finish(true);
      }
      session.current = finish;
      handle.setPointerCapture(pointer);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      handle.addEventListener('lostpointercapture', lost);
      setResizing(id);
    },
    [columns, header],
  );

  useEffect(() => () => session.current?.(true), []);

  return {
    resizing,
    active: () => session.current !== null,
    onPointerDown,
    cancel: () => session.current?.(false),
  };
}
