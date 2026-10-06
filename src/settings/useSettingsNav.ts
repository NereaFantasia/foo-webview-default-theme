import { useCallback, useEffect, useRef, useState, type RefCallback, type RefObject } from 'react';
import { createSettingsNav, type SettingsNav } from './settingsNav.ts';

/** 组的锚点 id。整个文档里要唯一，所以带前缀。 */
export function groupAnchor(group: string): string {
  return `settings-${group}`;
}

/** 组的元素上带这个属性，值是组名；目录联动按它认组。 */
export const GROUP_ATTR = 'data-settings-group';

/**
 * 点选之后等滚动停下的上限，毫秒。已经在目标位置时不会滚动、也就没有 `scrollend`，靠它放开钉住的那一组。
 */
const SCROLL_WAIT_MS = 1000;

/** 组进入滚动区上部四成才算「正在看」，否则一组刚露出标题就被判成当前组。 */
const WATCH_MARGIN = '0px 0px -60% 0px';

/** 这几个键会让滚动区自己滚。 */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);

export interface SettingsNavBinding {
  /** 目录里亮的那一组。 */
  readonly current: string;
  /** 挂到自己滚动的卡列上，各组要已经画在里面。 */
  readonly attach: RefCallback<HTMLElement>;
  /** 卡列的元素，没挂上时为 null。 */
  readonly scroller: RefObject<HTMLElement | null>;
  /** 点目录里的一项：滚到那一组，焦点落到它的标题上。 */
  select(group: string): void;
}

/**
 * 把目录与卡列的滚动连起来：滚动时亮的那一组跟着换，点目录滚到那一组。`order` 要是稳定的引用。
 * 减弱动效时滚动直接到位。
 */
export function useSettingsNav(order: readonly string[], reduced: boolean): SettingsNavBinding {
  const [current, setCurrent] = useState(() => order[0] ?? '');
  const model = useRef<SettingsNav | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  // 点选引起的滚动还没停下时是放开钉住的函数，停下后为 null；不为 null 时来的 scroll 事件是那次滚动自己的。
  const release = useRef<(() => void) | null>(null);

  const attach = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      if (!element) return;
      const nav = createSettingsNav(order, setCurrent);
      model.current = nav;
      scroller.current = element;
      setCurrent(nav.current());

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const group = entry.target.getAttribute(GROUP_ATTR);
            if (group !== null) nav.setVisible(group, entry.isIntersecting);
          }
        },
        { root: element, rootMargin: WATCH_MARGIN },
      );
      for (const group of element.querySelectorAll(`[${GROUP_ATTR}]`)) observer.observe(group);

      const onScroll = () => {
        // 点选的滚动停下之后再滚，不论是滚轮、空格翻页、触摸拖动还是焦点带着卡列走，都算用户自己滚的。
        if (release.current === null) nav.userScroll();
        nav.setAtBottom(element.scrollTop + element.clientHeight >= element.scrollHeight - 2);
      };
      const onWheel = () => nav.userScroll();
      // 目标是滚动区自己，说明按在了它的滚动条上。
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
    [order],
  );

  useEffect(() => () => release.current?.(), []);

  const select = useCallback(
    (group: string) => {
      const nav = model.current;
      const box = scroller.current;
      const target = document.getElementById(groupAnchor(group));
      if (!nav || !box || !target) return;
      release.current?.();
      nav.select(group);
      // 只滚卡列自己：`scrollIntoView` 会连带去滚外面裁剪溢出的容器。组的上沿停在卡列的上内边距之下。
      const offset = target.getBoundingClientRect().top - box.getBoundingClientRect().top;
      const inset = Number.parseFloat(getComputedStyle(box).paddingTop) || 0;
      box.scrollTo({
        top: box.scrollTop + offset - inset,
        behavior: reduced ? 'auto' : 'smooth',
      });
      target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      const done = () => {
        clearTimeout(timer);
        box.removeEventListener('scrollend', done);
        release.current = null;
        nav.release();
      };
      const timer = setTimeout(done, SCROLL_WAIT_MS);
      box.addEventListener('scrollend', done);
      release.current = done;
    },
    [reduced],
  );

  return { current, attach, scroller, select };
}
