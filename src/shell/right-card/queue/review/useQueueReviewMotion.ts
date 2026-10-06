import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { reducedMotionAtom } from '../../../../motion/reducedMotion.ts';
import { CURVE, DURATION_MS } from '../../../../motion/timing.ts';

/** 开合、拉开收拢之前那一帧的样子；都按视觉位置量（含仍在播放的位移）。 */
interface Snapshot {
  /** 队列滚动区的上缘，即历史区与队列的交界。 */
  readonly boundary: number;
  readonly scrollerHeight: number;
  readonly opacity: number;
  /** 记录内容第 0 行的上缘（减去滚动量），拉开、收拢时内容从这里接着走。 */
  readonly content: number;
  readonly scroll: number;
  readonly list: number;
  readonly arrow: number | null;
}

interface ReviewMotionOptions {
  /** 队列页的根；它的父元素是队列滚动区。 */
  readonly root: RefObject<HTMLElement | null>;
  /** 历史区的底板（底色、记录与箭头），按交界裁切。 */
  readonly panel: RefObject<HTMLElement | null>;
  /** 记录列表，也是它自己的滚动容器。 */
  readonly records: RefObject<HTMLElement | null>;
  /** 底板底边拉开、收拢的那一条；记录没超出视口内上限时不在。 */
  readonly arrow: RefObject<HTMLElement | null>;
  readonly open: boolean;
  /** 记录列表的高度，拉开后更高。 */
  readonly listHeight: number;
}

const running = (animation: Animation) => animation.playState === 'running';

/**
 * 终态先排好，再把交界（队列滚动区的上缘）从原来的位置移到新位置；历史区底板按交界裁切，快速反向时从当前
 * 视觉位置接续。滚动区变矮（展开、拉开）的这一程它先保持原来的高度，下缘落在卡片外被裁掉，播完再放开。
 *
 * 拉开、收拢时记录内容跟交界同一条曲线走，箭头贴着交界。收拢的终态列表更矮，装不下起点那一帧，所以这一程
 * 列表先保持原来的高度与滚动位置，播完再换成终态的高度与滚动位置。
 */
export function useQueueReviewMotion({
  root,
  panel,
  records,
  arrow,
  open,
  listHeight,
}: ReviewMotionOptions) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [present, setPresent] = useState(open);
  const snapshot = useRef<Snapshot | null>(null);
  const animations = useRef<Animation[]>([]);
  const generation = useRef(0);
  const previousOpen = useRef(open);
  // 这一程里临时保持的高度；播完或被打断时放开。
  const held = useRef<{ list: boolean; scroller: boolean }>({ list: false, scroller: false });
  if (open && !present) setPresent(true);

  const measure = useCallback((): Snapshot | null => {
    const scroller = root.current?.parentElement;
    const list = records.current;
    if (!scroller || !list) return null;
    return {
      boundary: scroller.getBoundingClientRect().top,
      scrollerHeight: scroller.offsetHeight,
      opacity: Number(getComputedStyle(list).opacity),
      content: list.getBoundingClientRect().top - list.scrollTop,
      scroll: list.scrollTop,
      list: list.offsetHeight,
      arrow: arrow.current?.getBoundingClientRect().top ?? null,
    };
  }, [root, records, arrow]);

  useLayoutEffect(() => {
    const mine = ++generation.current;
    const wasOpen = previousOpen.current;
    previousOpen.current = open;
    // 位移期间行数或窗口尺寸变化时，用仍在播放的变换接到新的终点。
    const before = snapshot.current ?? (animations.current.some(running) ? measure() : null);
    snapshot.current = null;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const scroller = root.current?.parentElement;
    const list = records.current;
    const board = panel.current;
    const release = () => {
      if (held.current.list && list) list.style.height = `${listHeight}px`;
      if (held.current.scroller && scroller) scroller.style.height = '';
      held.current = { list: false, scroller: false };
    };
    release();
    if (!scroller || !list || !board || !before || reduced) {
      if (!open) setPresent(false);
      return;
    }
    const boundary = scroller.getBoundingClientRect().top;
    const delta = before.boundary - boundary;
    const options = {
      duration: delta < 0 ? DURATION_MS.slow : DURATION_MS.fast,
      easing: CURVE.pointToPoint.timing,
    };
    const track = (animation: Animation) => {
      animations.current.push(animation);
      return animation;
    };
    // 滚动区变矮时先保持原来的高度：起点那一帧它的下缘仍在卡片底边。
    if (delta < 0) {
      scroller.style.height = `${scroller.offsetHeight - delta}px`;
      held.current.scroller = true;
    }
    track(
      scroller.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        options,
      ),
    );
    const resizing = open && wasOpen && before.list !== listHeight;
    // 列表放开高度后要回到的滚动位置：视口那边按终态高度算好的值。
    const settled = list.scrollTop;
    if (resizing) {
      const shrinking = listHeight < before.list;
      const extent = shrinking ? before.list : listHeight;
      const keep = shrinking ? before.scroll : settled;
      if (shrinking) {
        held.current.list = true;
        list.style.height = `${extent}px`;
        list.scrollTop = keep;
        list.dataset.queueMotionScroll = String(list.scrollTop);
      }
      const from = before.content - (list.getBoundingClientRect().top - keep);
      const to = keep - settled;
      const top = (offset: number) => `inset(${Math.max(0, -offset)}px 0 0 0)`;
      track(
        list.animate(
          [
            { transform: `translateY(${from}px)`, clipPath: top(from) },
            { transform: `translateY(${to}px)`, clipPath: top(to) },
          ],
          { ...options, fill: 'forwards' },
        ),
      );
      const strip = arrow.current;
      if (strip && before.arrow !== null) {
        const now = strip.getBoundingClientRect().top;
        const end = shrinking ? -(extent - listHeight) : 0;
        track(
          strip.animate(
            [
              { transform: `translateY(${before.arrow - now}px)` },
              { transform: `translateY(${end}px)` },
            ],
            { ...options, fill: 'forwards' },
          ),
        );
      }
    } else {
      const fade = { duration: DURATION_MS.faster, easing: CURVE.linear.timing };
      track(list.animate([{ opacity: before.opacity }, { opacity: open ? 1 : 0 }], fade));
    }
    // 底板按交界裁切：交界以下的部分不画，交界移到哪里底板就露到哪里。
    const boardTop = board.getBoundingClientRect().top;
    const boardHeight = board.offsetHeight;
    const clip = (edge: number) => `inset(0 0 ${Math.max(0, boardHeight - (edge - boardTop))}px 0)`;
    track(
      board.animate([{ clipPath: clip(before.boundary) }, { clipPath: clip(boundary) }], {
        ...options,
        fill: 'forwards',
      }),
    );
    void Promise.allSettled(animations.current.map((animation) => animation.finished)).then(() => {
      if (generation.current !== mine) return;
      if (held.current.list) {
        list.style.height = `${listHeight}px`;
        list.scrollTop = settled;
        list.dataset.queueMotionScroll = String(list.scrollTop);
      }
      release();
      if (!open) {
        setPresent(false);
        return;
      }
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    });
  }, [open, listHeight, reduced, root, panel, records, arrow, measure]);
  useLayoutEffect(
    () => () => {
      generation.current++;
      animations.current.forEach((animation) => animation.cancel());
    },
    [],
  );
  return {
    present,
    /** 改开合或拉开状态之前调：记下这一帧，终态排好后从这里动起来。 */
    capture() {
      snapshot.current = measure();
    },
  };
}
