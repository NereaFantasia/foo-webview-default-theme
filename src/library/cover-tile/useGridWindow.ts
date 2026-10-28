import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { visibleRows } from './gridWindow.ts';

/** 视口上下额外渲染的缓冲行数，在防白屏与 DOM 开销间权衡 */
const OVERSCAN_ROWS = 2;
/** 首次挂载尚未完成尺寸测量时的默认渲染行数 */
const INITIAL_ROWS = 4;

export interface GridWindowOptions {
  /** 滚动容器元素；传入 undefined 时禁用虚拟化全量渲染，null 表示尚未完成 DOM 绑定 */
  readonly scroller: HTMLElement | null | undefined;
  /** 网格的行层元素，量它的上沿 */
  readonly list: RefObject<HTMLElement | null>;
  readonly rowCount: number;
  readonly perRow: number;
  readonly rowHeight: number;
}

export interface GridWindow {
  /** 要画的行区间 `[first, last)` */
  readonly first: number;
  readonly last: number;
  /** 列数变化前滚动容器的 scrollTop（列数未变时为 null），供重排动画计算视口位移 */
  readonly scrollBefore: number | null;
}

/**
 * 平铺网格虚拟滚动与重排滚动锚定
 *
 * 固定行高场景下无需逐项测量；基于网格相对于滚动容器的偏移量与可视高度计算可见行切片。
 * 容器宽度变化导致列数重排时，以重排前视口顶部的首项为锚点补偿 scrollTop，保持当前内容视觉稳定
 */
export function useGridWindow(options: GridWindowOptions): GridWindow {
  const { scroller, list, rowCount, perRow, rowHeight } = options;
  const [range, setRange] = useState(() => ({ first: 0, last: Math.min(rowCount, INITIAL_ROWS) }));
  /** 上一次测量的列数与视口顶部锚定项索引 */
  const anchor = useRef({ columns: perRow, item: 0 });
  const measure = useCallback(() => {
    const grid = list.current;
    if (!scroller || !grid) return;
    const top = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const next = visibleRows(top, scroller.clientHeight, rowHeight, rowCount, OVERSCAN_ROWS);
    anchor.current = {
      columns: perRow,
      item: Math.max(0, Math.floor(-top / Math.max(1, rowHeight))) * perRow,
    };
    setRange((old) => (old.first === next.first && old.last === next.last ? old : next));
  }, [scroller, list, rowCount, rowHeight, perRow]);

  useLayoutEffect(() => {
    if (!scroller) return;
    const before = anchor.current;
    if (before.columns > 0 && before.columns !== perRow && before.item > 0) {
      const shift =
        (Math.floor(before.item / perRow) - Math.floor(before.item / before.columns)) * rowHeight;
      if (shift !== 0) scroller.scrollTop += shift;
    }
    measure();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (list.current) observer.observe(list.current);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [scroller, list, measure, perRow, rowHeight]);

  if (scroller === undefined) return { first: 0, last: rowCount, scrollBefore: null };
  const changed = !!scroller && anchor.current.columns > 0 && anchor.current.columns !== perRow;
  return {
    first: Math.min(range.first, rowCount),
    last: Math.min(range.last, rowCount),
    scrollBefore: changed ? scroller.scrollTop : null,
  };
}
