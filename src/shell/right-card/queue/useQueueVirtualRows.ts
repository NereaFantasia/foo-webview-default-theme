import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useStickyViewport } from '../../../table/useStickyViewport.ts';

export const QUEUE_ROW_HEIGHT = 48;

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

/** 与表格共用粘性视口，合成线程先滚动时保留上一帧，脚本补齐行带后再对齐。 */
export function useQueueVirtualRows(
  root: RefObject<HTMLElement | null>,
  count: number,
  scrollRoot?: RefObject<HTMLElement | null>,
) {
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
  // 偏移没变时不重渲染。
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
    estimateSize: () => QUEUE_ROW_HEIGHT,
    overscan: 12,
    scrollMargin: margin,
  });
  const totalSize = virtualizer.getTotalSize();
  useStickyViewport(scroller, viewport, strip, {
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
    /** 此刻量出来的偏移；上方内容刚变了高时，`margin` 要到下一次渲染才跟上。 */
    measureMargin: () => {
      const box = scroller.current;
      const body = element.current;
      return box && body ? layoutTop(body) - layoutTop(box) : margin;
    },
    height: totalSize,
    viewportHeight: height,
  };
}
