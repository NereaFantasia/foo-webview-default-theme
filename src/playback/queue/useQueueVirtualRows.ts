import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useStickyViewport } from '../../table/useStickyViewport.ts';
import { useQueueRowHeight } from './queueRowHeight.ts';

function layoutTop(element: HTMLElement): number {
  let top = 0;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null
  )
    top += node.offsetTop;
  return top;
}

/** 平常在视口上下各多挂载的行数；原生滚动时没有粘性视口兜底，缓冲要大得多（见 `useQueueVirtualRows`） */
const OVERSCAN_STICKY = 8;
const OVERSCAN_NATIVE = 20;

export interface QueueVirtualRowsOptions {
  /**
   * 缺省开：与表格共用粘性视口，合成线程先滚动时保留上一帧，脚本补齐行带后再对齐，快速拖滚动条也不露空白
   * 关掉时行直接画在列表里，随滚动内容由浏览器原生滚动，不再有每个滚动事件都改一次的行带平移
   * 行带下面垫着别的合成层（窗口背景、阅读面的毛玻璃）时会因重叠被单独合成，平移落在小数设备像素上，
   * 非整数缩放下滚动停下后文字发糊，要等某次重绘才变清；原生滚动没有这一层。代价是快速拖滚动条时补画不及，
   * 会短暂露出空白
   */
  readonly sticky?: boolean;
}

export function useQueueVirtualRows(
  root: RefObject<HTMLElement | null>,
  count: number,
  scrollRoot?: RefObject<HTMLElement | null>,
  { sticky = true }: QueueVirtualRowsOptions = {},
) {
  const rowHeight = useQueueRowHeight();
  // 不用粘性视口时交给它一个永远是空的滚动容器引用，它的监听就挂不上
  const unused = useRef<HTMLElement | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const box =
      scrollRoot?.current ??
      root.current?.parentElement ??
      element.current?.closest('[data-queue-page]')?.parentElement;
    scroller.current = box ?? null;
    const body = element.current;
    if (!box || !body) return;
    const measure = () => {
      setMargin(layoutTop(body) - layoutTop(box));
      setHeight(box.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [root, count, scrollRoot]);
  // 上方的内容换了高、总高却没变时（前面那一段多一行、接下来少一行）不触发尺寸回调，每次提交后都核对一次；
  // 偏移没变时不重渲染
  const [recheck] = useState(() => () => {
    const box = scroller.current;
    const body = element.current;
    if (box && body) setMargin(layoutTop(body) - layoutTop(box));
  });
  useLayoutEffect(() => recheck());
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () =>
      scrollRoot?.current ??
      root.current?.parentElement ??
      element.current?.closest('[data-queue-page]')?.parentElement ??
      null,
    estimateSize: () => rowHeight,
    // 粘性视口在合成线程先滚动时会留着上一帧，脚本补齐行带之前不露空白；原生滚动没有这层兜底，拖得比挂载快就会露出
    // 没挂行的空白，只能靠更大的预渲染缓冲：快速拖动时合成线程在已挂载的行上多滚一阵，脚本来得及补上
    overscan: sticky ? OVERSCAN_STICKY : OVERSCAN_NATIVE,
    scrollMargin: margin,
  });
  const totalSize = virtualizer.getTotalSize();
  useStickyViewport(sticky ? scroller : unused, viewport, strip, {
    margin,
    header: 0,
    stickyTop: 0,
    bottomInset: 0,
    total: totalSize,
    height: Math.min(height, totalSize),
  });
  return {
    element,
    viewport,
    strip,
    virtualizer,
    visible: virtualizer.getVirtualItems(),
    margin,
    /** 此刻量出来的偏移；上方内容刚变了高时，`margin` 要到下一次渲染才跟上 */
    measureMargin: () => {
      const box = scroller.current;
      const body = element.current;
      return box && body ? layoutTop(body) - layoutTop(box) : margin;
    },
    height: totalSize,
    viewportHeight: height,
  };
}
