import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

/** 表体在滚动内容里的位置与上下遮挡高度。表格自己滚动时只有底部遮挡可能非 0。 */
export interface ScrollFrame {
  /** 表体顶边在滚动元素的滚动内容里的纵坐标，CSS 像素：上面页头、列头的高都算在里面。 */
  readonly margin: number;
  /**
   * 行的可见区的上沿离滚动元素内边距盒上沿多远，CSS 像素：滚动元素的上内边距加列头的高。吸顶的元素
   * 贴在内边距以内，不贴在滚动元素的边上，所以内边距也要算进来。
   */
  readonly stickyTop: number;
  /** 吸顶列头自己的高，CSS 像素；贴住视口的那一层的 `top` 取它，内边距由浏览器自己加。 */
  readonly header: number;
  /**
   * 滚动元素的下内边距，CSS 像素。页面在底部留它给浮在上面的东西让位（窄窗的播放栏胶囊），行滚进这一截
   * 可能被盖住：焦点行滚进视口、键盘翻页与开菜单都只算它上面的那一截。
   */
  readonly bottomInset: number;
}

const OWN: ScrollFrame = { margin: 0, stickyTop: 0, header: 0, bottomInset: 0 };

export interface ScrollTarget {
  /** 行跟着滚的元素：给了外部元素就是它，否则是表格自己的滚动区。外部元素换了就换一个对象。 */
  readonly scroller: RefObject<HTMLElement | null>;
  readonly frame: ScrollFrame;
}

/**
 * `node` 的顶边在 `ancestor` 的滚动内容里有多深：沿定位祖先一路加 `offsetTop`。`offsetTop` 不受滚动与
 * `transform` 影响，页面切换的缩放途中量出来也对。`ancestor` 不是定位元素、不在这条链上时，退回按视口
 * 坐标量，缩放途中会量歪。
 */
function depthIn(node: HTMLElement, ancestor: HTMLElement): number {
  let depth = 0;
  let at: HTMLElement | null = node;
  while (at && at !== ancestor) {
    depth += at.offsetTop;
    const parent: Element | null = at.offsetParent;
    at = parent instanceof HTMLElement ? parent : null;
  }
  if (at === ancestor) return depth;
  const top = node.getBoundingClientRect().top - ancestor.getBoundingClientRect().top;
  return top + ancestor.scrollTop - ancestor.clientTop;
}

/**
 * 行跟着哪个元素滚、表体在它里面的位置。`body` 是表格里装行的那一层（列头在它上面），表格自己滚时它就是
 * 滚动区；`root` 是表格根元素。`external` 为 undefined 时表格自己滚，位置答 0。
 *
 * 表格上方的内容换了高度时，表格整体挪了位置、自身大小不变，观察表格量不到；所以同时观察滚动元素与它的
 * 各个直接子元素，表格每次重画后也再量一次。
 */
export function useScrollFrame(
  external: HTMLElement | null | undefined,
  body: RefObject<HTMLElement | null>,
  root: RefObject<HTMLElement | null>,
): ScrollTarget {
  const scroller = useMemo<RefObject<HTMLElement | null>>(
    () => (external === undefined ? body : { current: external }),
    [external, body],
  );
  const [frame, setFrame] = useState<ScrollFrame>(OWN);
  const [measure] = useState(() => (scroll: HTMLElement | null | undefined) => {
    const rows = body.current;
    const table = root.current;
    const target = scroll === undefined ? rows : scroll;
    const bottomInset = target ? Number.parseFloat(getComputedStyle(target).paddingBottom) || 0 : 0;
    let next = { ...OWN, bottomInset };
    if (scroll && rows && table) {
      // 装行的那一层不是定位元素，它的 `offsetTop` 从表格根元素算起，就是列头的高。
      const header = rows.offsetTop;
      const style = getComputedStyle(scroll);
      const inset = Number.parseFloat(style.paddingTop) || 0;
      const margin = depthIn(table, scroll) + header;
      next = { margin, stickyTop: inset + header, header, bottomInset };
    }
    setFrame((now) =>
      now.margin === next.margin &&
      now.stickyTop === next.stickyTop &&
      now.header === next.header &&
      now.bottomInset === next.bottomInset
        ? now
        : next,
    );
  });

  useLayoutEffect(() => {
    measure(external);
  });

  useLayoutEffect(() => {
    const target = external === undefined ? body.current : external;
    if (!target) return;
    const observer = new ResizeObserver(() => measure(external));
    observer.observe(target);
    if (external) {
      for (const child of external.children) observer.observe(child);
      if (root.current) observer.observe(root.current);
    }
    return () => observer.disconnect();
  }, [external, body, root, measure]);

  return { scroller, frame };
}
