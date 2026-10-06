import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { reducedMotionAtom } from './reducedMotion.ts';
import { edgeMove, stepEnter, type StepDirection } from './stepTransition.ts';
import { CURVE, DURATION_MS, motionDuration } from './timing.ts';

export interface StepMotionTargets {
  /** 对话框的底板：顶边不动，底边随高度伸缩。 */
  readonly surface: RefObject<HTMLElement | null>;
  /** 每一步换掉的那部分：标题与正文。 */
  readonly page: RefObject<HTMLElement | null>;
  /** 页脚：跟着底边走。 */
  readonly footer: RefObject<HTMLElement | null>;
}

interface EdgeRun {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly started: number;
  readonly animations: readonly Animation[];
}

/** 一次底边移动的进行状态与上一次量到的高度，跨渲染保留。 */
interface EdgeState {
  height: number | null;
  run: EdgeRun | null;
}

/**
 * 此刻看得见的底边高度：动画进行中按进度算，否则就是上一次量到的高度。高度一律量布局尺寸
 * （`offsetHeight`），不含变换：对话框入场时整体从 1.05 缩到 1，按屏幕上的尺寸量会差出这一截。
 */
function visibleHeight(state: EdgeState, surface: HTMLElement): number {
  const current = state.run;
  if (!current) return state.height ?? surface.offsetHeight;
  const elapsed = performance.now() - current.started;
  const ratio = current.duration ? Math.min(1, Math.max(0, elapsed / current.duration)) : 1;
  return current.from + (current.to - current.from) * CURVE.pointToPoint.ease(ratio);
}

/** 撤掉进行中的动画与钉住的高度，量出布局本来的高度。 */
function settle(state: EdgeState, surface: HTMLElement): number {
  state.run?.animations.forEach((animation) => animation.cancel());
  state.run = null;
  surface.style.minHeight = '';
  return surface.offsetHeight;
}

/**
 * 底边从 `from` 高移到布局此刻的高度。变高时布局已经到位，只用裁剪露出；变矮时先把底板钉回 `from`，
 * 播完再撤掉，布局一次换到终值。`allowShrink` 为假时变矮直接到位：在 ResizeObserver 的回调里改高度，
 * 会让同一帧再报一次尺寸变化。
 */
function moveEdge(
  state: EdgeState,
  targets: StepMotionTargets,
  from: number,
  ms: number,
  reduced: boolean,
  allowShrink: boolean,
): void {
  const surface = targets.surface.current;
  const footer = targets.footer.current;
  if (!surface || !footer) return;
  const to = settle(state, surface);
  state.height = to;
  if (to < from && !allowShrink) return;
  const move = edgeMove(from, to, ms, reduced);
  if (!move) return;
  if (to < from) surface.style.minHeight = `${from}px`;
  const animations = [
    surface.animate(move.surface.keyframes, move.surface.options),
    footer.animate(move.footer.keyframes, move.footer.options),
  ];
  const mine: EdgeRun = {
    from,
    to,
    duration: motionDuration(ms, reduced),
    started: performance.now(),
    animations,
  };
  state.run = mine;
  void animations[0]?.finished.then(
    () => {
      if (state.run === mine) settle(state, surface);
    },
    () => {},
  );
}

/**
 * 分步对话框的换步与高度变化（换步配方）。`step` 变了：标题与正文按方向横移进来，底板与页脚 250 ms
 * 点到点到新高度；同一步里内容长高（插进一块、说明行换行）：底板与页脚 167 ms。布局不逐帧改。
 * 中途再变，从此刻看得见的高度接着走。打开时的第一步不播，那时对话框本身在入场。`active` 是对话框
 * 开着：底板只在开着时存在，开了才开始量。
 */
export function useStepMotion(
  targets: StepMotionTargets,
  step: string,
  direction: StepDirection,
  active: boolean,
): void {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const state = useRef<EdgeState>({ height: null, run: null });
  const shown = useRef(step);
  // 换步时按这一次渲染的方向与减弱动效来播；两者变了不单独触发。
  const latest = useRef({ targets, direction, reduced });
  useLayoutEffect(() => {
    latest.current = { targets, direction, reduced };
  });

  useLayoutEffect(() => {
    const { targets: current, direction: way, reduced: still } = latest.current;
    const surface = current.surface.current;
    if (!surface || shown.current === step) return;
    shown.current = step;
    const from = visibleHeight(state.current, surface);
    for (const leg of stepEnter(way, still)) {
      current.page.current?.animate(leg.keyframes, leg.options);
    }
    moveEdge(state.current, current, from, DURATION_MS.normal, still, true);
  }, [step]);

  useEffect(() => {
    const surface = latest.current.targets.surface.current;
    if (!active || !surface) return;
    const edge = state.current;
    edge.height = surface.offsetHeight;
    const observer = new ResizeObserver(() => {
      // 换步与钉住的高度由上面处理；这里只接同一步里内容自己变高变矮。
      if (edge.run) return;
      const previous = edge.height;
      const next = surface.offsetHeight;
      if (previous === null || Math.abs(next - previous) < 1) return;
      moveEdge(
        edge,
        latest.current.targets,
        previous,
        DURATION_MS.fast,
        latest.current.reduced,
        false,
      );
    });
    observer.observe(surface);
    return () => {
      observer.disconnect();
      settle(edge, surface);
    };
  }, [active]);
}
