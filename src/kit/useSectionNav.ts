import { useCallback, useEffect, useRef, useState, type RefCallback, type RefObject } from 'react';
import { createSectionNav, type SectionNav } from './sectionNav.ts';

/**
 * 点选之后滚动停住多久还没等到 `scrollend` 就放开钉住的那一组，毫秒。已经在目标位置时不会滚动、也就没有
 * `scrollend`，靠它放开；滚动途中每来一次 scroll 事件就重新计时，所以不限制滚动本身要多久
 */
const SCROLL_WAIT_MS = 1000;

/** 组进入滚动区上部四成才算「正在看」，否则一组刚露出标题就被判成当前组 */
const WATCH_MARGIN = '0px 0px -60% 0px';

/** 这几个键会让滚动区自己滚 */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);

/** 各组在页面上怎么认、怎么找；要是稳定的引用 */
export interface SectionSpec {
  /** 组的元素上带这个属性，值是组名；联动按它认组 */
  readonly attr: string;
  /** 点选时找组的元素；`box` 是滚动区 */
  find(box: HTMLElement, group: string): HTMLElement | null;
  /** 点选后焦点落到组里的哪个元素（选择器）；不给就不动焦点 */
  readonly focus?: string;
}

export interface SectionNavBinding {
  /** 导航里亮的那一组 */
  readonly current: string;
  /** 挂到自己滚动的区域上，各组要已经画在里面 */
  readonly attach: RefCallback<HTMLElement>;
  /** 滚动区的元素，没挂上时为 null */
  readonly scroller: RefObject<HTMLElement | null>;
  /** 点导航里的一项：滚到那一组，`spec.focus` 给了就把焦点落到它上 */
  select(group: string): void;
}

/**
 * 把分节导航与滚动区的滚动连起来：滚动时亮的那一组跟着换，点导航滚到那一组。`order` 与 `spec` 要是稳定的引用
 * 减弱动效时滚动直接到位
 */
export function useSectionNav(
  order: readonly string[],
  reduced: boolean,
  spec: SectionSpec,
): SectionNavBinding {
  const [current, setCurrent] = useState(() => order[0] ?? '');
  const model = useRef<SectionNav | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  // 点选引起的滚动还没停下时是放开钉住的函数，停下后为 null；不为 null 时来的 scroll 事件是那次滚动自己的
  const release = useRef<(() => void) | null>(null);

  const attach = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      // 一组都没有（如搜索没有命中）时没有可联动的
      if (!element || order.length === 0) return;
      const nav = createSectionNav(order, setCurrent);
      model.current = nav;
      scroller.current = element;
      setCurrent(nav.current());

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const group = entry.target.getAttribute(spec.attr);
            if (group !== null) nav.setVisible(group, entry.isIntersecting);
          }
        },
        { root: element, rootMargin: WATCH_MARGIN },
      );
      for (const group of element.querySelectorAll(`[${spec.attr}]`)) observer.observe(group);

      const onScroll = () => {
        // 点选的滚动停下之后再滚，不论是滚轮、空格翻页、触摸拖动还是焦点带着滚动区走，都算用户自己滚的
        if (release.current === null) nav.userScroll();
        nav.setAtBottom(element.scrollTop + element.clientHeight >= element.scrollHeight - 2);
      };
      const onWheel = () => nav.userScroll();
      // 目标是滚动区自己，说明按在了它的滚动条上
      const onPointerDown = (event: PointerEvent) => {
        if (event.target === element) nav.userScroll();
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (SCROLL_KEYS.has(event.key)) nav.userScroll();
      };
      element.addEventListener('scroll', onScroll, { passive: true });
      element.addEventListener('wheel', onWheel, { passive: true });
      element.addEventListener('pointerdown', onPointerDown);
      element.addEventListener('keydown', onKeyDown);
      return () => {
        observer.disconnect();
        element.removeEventListener('scroll', onScroll);
        element.removeEventListener('wheel', onWheel);
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('keydown', onKeyDown);
        release.current?.();
        model.current = null;
        scroller.current = null;
      };
    },
    [order, spec.attr],
  );

  useEffect(() => () => release.current?.(), []);

  const select = useCallback(
    (group: string) => {
      const nav = model.current;
      const box = scroller.current;
      const target = box ? spec.find(box, group) : null;
      if (!nav || !box || !target) return;
      release.current?.();
      nav.select(group);
      // 只滚滚动区自己：`scrollIntoView` 会连带去滚外面裁剪溢出的容器。组的上沿停在滚动区的上内边距之下
      const offset = target.getBoundingClientRect().top - box.getBoundingClientRect().top;
      const inset = Number.parseFloat(getComputedStyle(box).paddingTop) || 0;
      box.scrollTo({
        top: box.scrollTop + offset - inset,
        behavior: reduced ? 'auto' : 'smooth',
      });
      if (spec.focus) target.querySelector<HTMLElement>(spec.focus)?.focus({ preventScroll: true });
      const done = () => {
        clearTimeout(timer);
        box.removeEventListener('scrollend', done);
        box.removeEventListener('scroll', rearm);
        release.current = null;
        nav.release();
      };
      // 长距离的平滑滚动可以超过一秒：还在滚就继续等，停住超过上限才放开
      const rearm = () => {
        clearTimeout(timer);
        timer = setTimeout(done, SCROLL_WAIT_MS);
      };
      let timer = setTimeout(done, SCROLL_WAIT_MS);
      box.addEventListener('scrollend', done);
      box.addEventListener('scroll', rearm, { passive: true });
      release.current = done;
    },
    [reduced, spec],
  );

  return { current, attach, scroller, select };
}
