import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ScrollFrame } from './useScrollFrame.ts';

/** 贴住视口那一层要知道的：表体在滚动内容里的位置、条目流的总高与这一层最高能有多高。 */
export interface StickyPlacement extends ScrollFrame {
  /** 条目流的总高，也就是表体的高，CSS 像素。 */
  readonly total: number;
  /** 这一层最高的高：滚动元素里行看得见的那一截，条目流更矮时取条目流的高。 */
  readonly height: number;
}

/**
 * 此刻贴住视口的那一层盖住表体的哪一截：上沿在表体里的纵坐标与这一截的高。表体的底边升到可见区里之后
 * （滚到了表格的末尾，下面只剩页面的下内边距），这一层跟着变矮，上沿仍贴在列头下面：浏览器只会把贴不下的
 * 粘性元素整块往上推，那样行就钻到列头底下去了。
 */
function shownRange(box: HTMLElement, placement: StickyPlacement) {
  const top = Math.max(0, box.scrollTop + placement.stickyTop - placement.margin);
  return { top, height: Math.max(0, Math.min(placement.height, placement.total - top)) };
}

/**
 * 虚拟列表的「粘性视口」：行画在贴住视口的一层里（`position: sticky`），这一层里的行带按滚动位置整条
 * 平移。浏览器的合成线程先把滚动容器挪过去，脚本随后才补画新位置的行；快速拖滚动条时一帧能跨几千像素，
 * 行跟着容器走的话中间那几帧会露出空白。行不跟容器走，那几帧就停在上一帧的画面上，脚本追上即对齐。
 *
 * 平移量与这一层的高在滚动事件里直接写，不经 React：虚拟化器只在可见区间的首尾变了才重画，按它算的话
 * 行带要滚过小半行才挪一下。每次重画后也对一次，程序滚动与条目变化之后不差一帧。
 *
 * 行跟着页面滚动时，这一层贴在吸顶列头下面，只在表体的范围里贴：表体顶边还在视口里时它随表体下移。
 */
export function useStickyViewport(
  scroller: RefObject<HTMLElement | null>,
  viewport: RefObject<HTMLElement | null>,
  strip: RefObject<HTMLElement | null>,
  placement: StickyPlacement,
): void {
  const latest = useRef({ placement, scroller });
  useLayoutEffect(() => {
    latest.current = { placement, scroller };
  });
  const [follow] = useState(() => () => {
    const box = latest.current.scroller.current;
    if (!box) return;
    const shown = shownRange(box, latest.current.placement);
    if (viewport.current) viewport.current.style.height = `${shown.height}px`;
    if (strip.current) strip.current.style.transform = `translateY(${-shown.top}px)`;
  });

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    box.addEventListener('scroll', follow, { passive: true });
    return () => box.removeEventListener('scroll', follow);
  }, [scroller, follow]);

  useLayoutEffect(() => {
    follow();
  });
}
