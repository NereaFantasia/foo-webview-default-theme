import { useVirtualizer, type Virtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useLayoutEffect, useState, type RefObject } from 'react';
import type { TableGroupItem, TableItem } from './tableItems.ts';
import type { ScrollFrame } from './useScrollFrame.ts';

/** 视口上下各多画几个条目：快速滚动时新进来的行已经在 DOM 里，不露白。 */
const OVERSCAN = 6;

export interface TrackTableRowsOptions<G> {
  readonly items: readonly TableItem<G>[];
  /** 曲目行与空位的高，CSS 像素。 */
  readonly rowHeight: number;
  /** 分组头的高；要给一个稳定的函数，它一变就整份重算位置。 */
  readonly groupHeight: (item: TableGroupItem<G>) => number;
  /**
   * 封面列此刻的宽，CSS 像素。封面画在分组头下面、压住组里的前几行，分组头滚出视口后还得留在 DOM 里，
   * 所以往上多留的条目数至少要盖住一张封面的高。
   */
  readonly coverWidth: number;
  /** 表体在滚动内容里的位置与上下遮挡高度；自己滚动时也可能有底部浮层。 */
  readonly frame: ScrollFrame;
}

export interface TrackTableRows {
  readonly virtualizer: Virtualizer<HTMLElement, Element>;
  /**
   * 此刻画出来的条目。`start` 是在滚动内容里的纵坐标，含 `frame.margin`；画在表体里要减掉它。
   */
  readonly visible: readonly VirtualItem[];
  readonly totalSize: number;
  /**
   * 贴住视口那一层最高的高：滚动容器的可见高减去吸顶列头，条目流比它矮时取条目流的高，免得多出一段可滚的
   * 空白。滚到表格末尾时它还会变矮，见 `useStickyViewport`。
   */
  readonly viewportHeight: number;
  /** 滚动容器里行看得见的高：可见高减去吸顶列头与下内边距，不按条目流夹。键盘翻一页按它算。 */
  readonly shownHeight: number;
}

/**
 * 表格按条目虚拟滚动。高度都由调用方给的常量与函数算出，不挂 `measureElement` 量 DOM。虚拟化器按序号
 * 缓存各条目的位置，条目数不变时不会自己重算：分组头换了高度、或同样多的条目换了一批，位置还按旧的摆，
 * 所以条目流与高度一变就调 `measure()`。
 *
 * 滚动区的可见高自己量：虚拟化器量到新尺寸后只在可见区间的首尾变了才叫重画，窗口高度只改了不到一行时
 * 不重画，贴住视口的那一层就停在旧高度，底下露出一截空白。
 *
 * 行跟着页面滚动时，表体上方的页头与列头交给虚拟化器当 `scrollMargin`，吸顶列头的高当
 * `scrollPaddingStart`：焦点行滚进视口时停在列头下面，不被它盖住。
 */
export function useTrackTableRows<G>(
  scroller: RefObject<HTMLElement | null>,
  options: TrackTableRowsOptions<G>,
): TrackTableRows {
  const { items, rowHeight, groupHeight, coverWidth, frame } = options;
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    setHeight(box.clientHeight);
    const observer = new ResizeObserver(() => setHeight(box.clientHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, [scroller]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => {
      const item = items[index];
      return item?.kind === 'group' ? groupHeight(item) : rowHeight;
    },
    overscan: Math.max(OVERSCAN, Math.ceil(coverWidth / rowHeight) + 2),
    scrollMargin: frame.margin,
    scrollPaddingStart: frame.stickyTop,
    scrollPaddingEnd: frame.bottomInset,
  });
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, items, rowHeight, groupHeight]);
  const totalSize = virtualizer.getTotalSize();
  return {
    virtualizer,
    visible: virtualizer.getVirtualItems(),
    totalSize,
    viewportHeight: Math.max(0, Math.min(height - frame.stickyTop, totalSize)),
    shownHeight: Math.max(0, height - frame.stickyTop - frame.bottomInset),
  };
}
