import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { CURVE } from '../../motion/timing.ts';
import { fadePaneParts, PANE_FADE_MS, type PaneFade } from '../../nav/sidebar/paneFades.ts';
import { RAIL_WIDTH } from '../../nav/sidebar/sidebarSnap.ts';
import type { SidebarForm, SidebarTier } from '../../nav/sidebar/sidebarView.ts';

/**
 * 换形态的时长，毫秒：展开、图标态与摆回来用 WinUI SplitView 的 `SplitViewPaneAnimationOpenDuration`，
 * 整个藏起来用 `SplitViewPaneAnimationCloseDuration`。
 */
export const PANE_MS = 200;
export const PANE_CLOSE_MS = 100;

export interface SidebarMotionOptions {
  /** 窗格里画侧边栏的那一层：裁剪与平移加在它身上。 */
  readonly pane: RefObject<HTMLElement | null>;
  /** 内容区：位移加在它身上。 */
  readonly content: RefObject<HTMLElement | null>;
  readonly form: SidebarForm;
  readonly tier: SidebarTier;
  /** 展开宽度。 */
  readonly width: number;
  readonly reduced: boolean;
}

/**
 * 窗格此刻的样子：内容从左边起露出 `reveal` 宽，其余裁掉，整体再往左挪 `shift`（≤ 0）。露出部分的右缘
 * `shift + reveal` 就是内容区左缘跟着走的那条线。
 */
interface PaneFrame {
  readonly shift: number;
  readonly reveal: number;
}

interface Running {
  /** 第一个是窗格的，按它的进度算此刻的样子。 */
  readonly animations: readonly Animation[];
  readonly duration: number;
  readonly from: PaneFrame;
  readonly to: PaneFrame;
}

interface Move {
  readonly from: SidebarForm;
  readonly to: SidebarForm;
  /** 窗格这一刻刚换上目标形态的内容：只在一种形态里有的部分从透明起步，不读此刻的透明度。 */
  readonly fresh: boolean;
}

/** 这一形态占的列宽，也是它停稳时窗格露出的宽度。 */
function formWidth(form: SidebarForm, width: number): number {
  if (form === 'none') return 0;
  return form === 'expanded' ? width : RAIL_WIDTH;
}

const edgeOf = (frame: PaneFrame) => frame.shift + frame.reveal;

/** 一段还在播的动画此刻播到哪；没在播答 null。 */
function frameNow(running: Running | null): PaneFrame | null {
  const time = running?.animations[0]?.currentTime;
  if (!running || typeof time !== 'number') return null;
  const eased = CURVE.pane.ease(Math.min(1, time / running.duration));
  const mix = (from: number, to: number) => from + (to - from) * eased;
  return {
    shift: mix(running.from.shift, running.to.shift),
    reveal: mix(running.from.reveal, running.to.reveal),
  };
}

/**
 * 侧边栏换形态的动画，照 WinUI SplitView 并排窗格的做法：布局在第 0 帧就到终值，不逐帧改宽；内容区从旧
 * 位置位移到新位置，窗格与它同一条曲线。
 *
 * - 展开 ↔ 图标态（200 ms）：窗格用裁剪露出或收起。展开时当场换成展开态；收起时展开态的内容留着、随裁剪
 *   收窄，走完才换成图标态。两种形态都有的导航项摆在同一个位置，不跟着跳；只在一种形态里有的部分
 *   （`paneFades.ts`）收起时先淡出、换上图标态再淡入，展开时稍等再淡入。
 * - 藏起来（100 ms）与摆回来（200 ms）：窗格整张往左滑出或从左边滑入，藏起来时滑出窗口才卸掉。
 *
 * 动画中又换了形态，从此刻的样子起步，不跳回头。跨档（窗口缩放跨过 1008）、减弱动效时直接到位。
 * 返回窗格此刻该画哪一种内容，`none` 是不画。
 */
export function useSidebarMotion(options: SidebarMotionOptions): SidebarForm {
  const { pane, content, form, tier, width, reduced } = options;
  const [shown, setShown] = useState<SidebarForm>(form);
  const [last, setLast] = useState({ form, tier });
  const [move, setMove] = useState<Move | null>(null);
  const running = useRef<Running | null>(null);
  const fades = useRef<Animation[]>([]);
  // 拖动中宽度一直在变，动画按起步那一刻的宽度算，不因宽度变了重来。
  const widthNow = useRef(width);
  widthNow.current = width;
  const shownNow = useRef(shown);
  shownNow.current = shown;
  // 上一次提交时的展开宽度，也就是换形态之前窗格露出的宽度：拖动中吸成图标态时存档的宽度已经换回拖动
  // 之前的值，按它起步窗格会先跳宽一截。
  const committedWidth = useRef(width);

  if (last.form !== form || last.tier !== tier) {
    const animated = !reduced && last.tier === tier && tier === 'wide';
    setLast({ form, tier });
    if (animated) {
      // 要露出的形态当场换上；收起到图标态等裁剪走完，藏起来等滑出去。
      const swap = form === 'expanded' || (form === 'rail' && shown === 'none');
      setMove({ from: last.form, to: form, fresh: swap && shown !== form });
      if (swap) setShown(form);
    } else {
      setMove(null);
      setShown(form);
    }
  }

  useLayoutEffect(() => {
    const stop = () => {
      for (const animation of running.current?.animations ?? []) animation.cancel();
      running.current = null;
    };
    if (!move) {
      stop();
      for (const animation of fades.current) animation.cancel();
      fades.current = [];
      return;
    }
    const paneElement = pane.current;
    const contentElement = content.current;
    if (!paneElement || !contentElement) return;
    const width = widthNow.current;
    const paneWidth = formWidth(shownNow.current, width);
    const settled: PaneFrame =
      move.from === 'none'
        ? { shift: -paneWidth, reveal: paneWidth }
        : { shift: 0, reveal: formWidth(move.from, committedWidth.current) };
    const from = frameNow(running.current) ?? settled;
    // 藏起来时裁剪停在此刻的位置，整张往左挪出它露出的那一截。
    const to: PaneFrame =
      move.to === 'none'
        ? { shift: -from.reveal, reveal: from.reveal }
        : { shift: 0, reveal: formWidth(move.to, width) };
    const collapsing = move.to === 'rail' && shownNow.current === 'expanded';
    stop();
    const duration = move.to === 'none' ? PANE_CLOSE_MS : PANE_MS;
    const timing = { duration, easing: CURVE.pane.timing };
    const place = (frame: PaneFrame) => ({
      translate: `${frame.shift}px 0`,
      clipPath: `inset(0 ${paneWidth - frame.reveal}px 0 0)`,
    });
    const paneMotion = paneElement.animate([place(from), place(to)], {
      ...timing,
      fill: 'forwards',
    });
    const shift = contentElement.animate(
      [{ translate: `${edgeOf(from) - edgeOf(to)}px 0` }, { translate: '0 0' }],
      timing,
    );
    const mine: Running = { animations: [paneMotion, shift], duration, from, to };
    running.current = mine;
    let fade: PaneFade | null = null;
    if (collapsing) fade = { to: 0 };
    else if (move.to === 'expanded' && move.from === 'rail') {
      fade = { to: 1, delay: PANE_FADE_MS, ...(move.fresh ? { from: 0 } : {}) };
    }
    if (fade) fades.current = fadePaneParts(paneElement, fade, fades.current);
    paneMotion.onfinish = () => {
      if (running.current !== mine) return;
      running.current = null;
      // 收起与藏起来：同一帧里换内容再撤掉裁剪与平移，中间不露出没裁的展开态。
      flushSync(() => {
        if (move.to !== 'expanded') setShown(move.to);
        setMove(null);
      });
      paneMotion.cancel();
      if (collapsing) fades.current = fadePaneParts(paneElement, { to: 1, from: 0 }, []);
    };
  }, [move, pane, content]);

  // 排在上面那个 effect 之后：它读到的还是上一次提交的宽度。
  useLayoutEffect(() => {
    committedWidth.current = width;
  });

  useLayoutEffect(
    () => () => {
      for (const animation of running.current?.animations ?? []) animation.cancel();
      for (const animation of fades.current) animation.cancel();
    },
    [],
  );

  return shown;
}
