import { useVirtualizer, type Virtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flowItemSize } from './albumDropdown.ts';
import { placeVisible, type PlacedTile } from './albumGridLayout.ts';
import type { AlbumWallLayout } from './useAlbumWallLayout.ts';
import { anchoredScrollTop, type FlowShape } from './wallReflow.ts';

/**
 * 视口上下各多画几个条目。按条目数算，一个条目是一整行图块，所以两条就是上下各多一两行：快速滚动时
 * 新进来的行已经在 DOM 里、不露白，DOM 里的图块又不至于多到让每帧的样式重算明显上涨。
 */
const OVERSCAN = 2;

export interface AlbumWallRows {
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** 此刻画出来的条目（节头与图块行），带各自的纵坐标。 */
  readonly rows: readonly VirtualItem[];
  /** 可见行里的图块，按专辑键摊平成一层，换列时同一张专辑复用同一个元素。 */
  readonly tiles: readonly PlacedTile[];
  readonly totalSize: number;
  /** 这次渲染换了列数时，滚动容器锚定之前的 scrollTop；没换列是 null。 */
  readonly scrollBefore: number | null;
}

interface Committed {
  readonly shape: FlowShape;
  readonly columns: number;
}

/** 滚动容器的下内边距，CSS 像素：能滚到的最低处是内容高加它再减视口高。 */
function bottomPadding(element: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(element).paddingBottom) || 0;
}

/**
 * 封面墙按行虚拟滚动：一个条目是一整行图块、一个节头或一条下拉。高度都由几何算出（图块行是边长加字行
 * 加行间距，节头按显示样式取，下拉按首数），`estimateSize` 给的就是准确值，不挂 `measureElement` 量 DOM。
 * 下拉开合时下面的行按旧位置平移，排版上已在视口外的几行看上去还在视口里；`reach` 是动画中的下拉
 * 面板高之和，按它多画几行，平移中不露白。
 *
 * 列数一变，滚动锚在换列前视口顶上那一行（`anchoredScrollTop`），夹到能滚到的最低处。锚定后的位置在渲染
 * 时就交给虚拟化器，这一次提交画的就是锚定后视口里的那几行；不这样的话要等滚动事件回来再画一次，中间一帧
 * 画的是按旧位置切出来的行，深处换列时整屏露白。
 */
export function useAlbumWallRows(
  scroller: RefObject<HTMLDivElement | null>,
  layout: AlbumWallLayout,
  reach = 0,
): AlbumWallRows {
  const { items, rowHeight, metrics, row } = layout;
  const { headerHeight } = metrics;
  // 虚拟化器只在条目数或取键的函数换了时才重算各条目的位置。键里带上条目的种类与行高、节头高，函数随
  // 条目流与这两个高换一个：条目数没变（每节只有一行时换列、改边长）也当场按新的几何排，这一次渲染切出来的
  // 行与位置就是对的。
  const getItemKey = useCallback(
    (index: number) => `${index}:${items[index]?.kind ?? ''}:${rowHeight}:${headerHeight}`,
    [items, rowHeight, headerHeight],
  );
  const [bottomInset, setBottomInset] = useState(0);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setBottomInset(bottomPadding(element));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => {
      const item = items[index];
      return item ? flowItemSize(item, rowHeight, headerHeight) : rowHeight;
    },
    getItemKey,
    scrollPaddingEnd: bottomInset,
    overscan: OVERSCAN + Math.ceil(reach / Math.max(1, rowHeight)),
  });
  const shape: FlowShape = { items, rowHeight, headerHeight };
  const columns = layout.width > 0 ? row.perRow : 0;
  const committed = useRef<Committed | null>(null);
  const last = committed.current;
  const element = scroller.current;
  let anchor: { readonly from: number; readonly to: number } | null = null;
  if (last && element && last.columns > 0 && columns > 0 && last.columns !== columns) {
    // 滚动容器的 scrollTop 要到提交之后才改，StrictMode 重跑这一次渲染时读到的还是同一个值。
    const from = element.scrollTop;
    const lowest = virtualizer.getTotalSize() + bottomPadding(element) - element.clientHeight;
    const to = Math.min(anchoredScrollTop(last.shape, shape, from), Math.max(0, lowest));
    anchor = { from, to };
    virtualizer.scrollOffset = to;
  }
  useLayoutEffect(() => {
    committed.current = { shape, columns };
    if (anchor && anchor.to !== anchor.from && scroller.current) {
      scroller.current.scrollTop = anchor.to;
    }
  });
  const rows = virtualizer.getVirtualItems();
  return {
    virtualizer,
    rows,
    tiles: placeVisible(items, rows, row),
    totalSize: virtualizer.getTotalSize(),
    scrollBefore: anchor?.from ?? null,
  };
}
