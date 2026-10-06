import {
  CURVE,
  DURATION_MS,
  PANE_DURATION_MS,
  motionDuration,
  type MotionCurve,
} from './timing.ts';

export type SurfaceKind = 'flyout' | 'dialog' | 'start' | 'end';

export interface SurfaceTransition {
  play(visible: boolean, reduced: boolean): Promise<boolean>;
  jump(visible: boolean): void;
  setPlaybackRate(rate: number): void;
  setPlayState(state: 'running' | 'paused'): void;
  dispose(): void;
}

interface Leg {
  readonly animation: Animation;
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly curve: MotionCurve;
}

function progress(leg: Leg | undefined, fallback: number): number {
  if (!leg) return fallback;
  const time = typeof leg.animation.currentTime === 'number' ? leg.animation.currentTime : 0;
  const ratio = leg.duration ? Math.min(1, Math.max(0, time / leg.duration)) : 1;
  return leg.from + (leg.to - leg.from) * leg.curve.ease(ratio);
}

/** Fluent 的方向变量带 px；乘以半边尺寸即可得到裁剪长度，不把长度当无单位数相除。 */
function flyoutFrame(element: HTMLElement, value: number): Keyframe {
  const away = 1 - value;
  const x = 'var(--fui-positioning-slide-direction-x, 0px)';
  const y = 'var(--fui-positioning-slide-direction-y, 0px)';
  const width = (element.offsetWidth * away) / 2;
  const height = (element.offsetHeight * away) / 2;
  return {
    translate: `calc(${x} * ${10 * away}) calc(${y} * ${10 * away})`,
    clipPath:
      `inset(calc(max(0px, ${y}) * ${height}) ` +
      `calc(max(0px, calc(-1 * ${x})) * ${width}) ` +
      `calc(max(0px, calc(-1 * ${y})) * ${height}) ` +
      `calc(max(0px, ${x}) * ${width}))`,
  };
}

function shapeFrame(element: HTMLElement, kind: SurfaceKind, value: number): Keyframe {
  if (kind === 'flyout') return flyoutFrame(element, value);
  if (kind === 'dialog') return { scale: String(1 + (1 - value) * 0.05) };
  const sign = kind === 'start' ? -1 : 1;
  const direction = getComputedStyle(element).direction === 'rtl' ? -sign : sign;
  return { translate: `${direction * (1 - value) * 100}% 0` };
}

/** 浮层的位置与透明度分别保留进度，反向前先取当前值，再取消旧动画。 */
export function createSurfaceTransition(
  element: HTMLElement,
  kind: SurfaceKind,
): SurfaceTransition {
  const drawer = kind === 'start' || kind === 'end';
  const curve = drawer ? CURVE.decelerateMax : CURVE.decelerateMid;
  let shape: Leg | undefined;
  let fade: Leg | undefined;
  let settled = 0;
  let generation = 0;

  function cancel(): void {
    generation++;
    shape?.animation.cancel();
    fade?.animation.cancel();
    shape = undefined;
    fade = undefined;
  }

  function animate(
    from: number,
    to: number,
    duration: number,
    easing: MotionCurve,
    frames: Keyframe[],
  ): Leg {
    return {
      from,
      to,
      duration,
      curve: easing,
      animation: element.animate(frames, { duration, easing: easing.timing, fill: 'both' }),
    };
  }

  return {
    play(visible, reduced) {
      const fromShape = progress(shape, settled);
      const fromFade = progress(fade, settled);
      const current = getComputedStyle(element);
      const start: Keyframe = shape
        ? { translate: current.translate, scale: current.scale, clipPath: current.clipPath }
        : shapeFrame(element, kind, fromShape);
      const opacity = fade ? current.opacity : String(fromFade);
      cancel();
      const mine = generation;
      const to = visible ? 1 : 0;
      const full = drawer
        ? visible
          ? PANE_DURATION_MS.overlayOpen
          : PANE_DURATION_MS.overlayClose
        : visible
          ? DURATION_MS.normal
          : DURATION_MS.fast;
      shape = animate(
        fromShape,
        to,
        motionDuration(full * Math.abs(to - fromShape), reduced),
        curve,
        [start, shapeFrame(element, kind, to)],
      );
      fade = drawer
        ? undefined
        : animate(
            fromFade,
            to,
            motionDuration(DURATION_MS.faster * Math.abs(to - fromFade), reduced),
            CURVE.linear,
            [{ opacity }, { opacity: to }],
          );
      const running = [shape.animation, ...(fade ? [fade.animation] : [])];
      return Promise.all(running.map((animation) => animation.finished)).then(
        () => {
          if (mine !== generation) return false;
          settled = to;
          // 进场结束撤掉裁剪，让阴影与溢出内容正常绘制；退场保持终帧，直到卸载或再次打开。
          if (visible) cancel();
          return true;
        },
        () => false,
      );
    },
    jump(visible) {
      cancel();
      settled = visible ? 1 : 0;
    },
    setPlaybackRate(rate) {
      for (const leg of [shape, fade]) if (leg) leg.animation.updatePlaybackRate(rate);
    },
    setPlayState(state) {
      for (const leg of [shape, fade]) {
        if (state === 'paused') leg?.animation.pause();
        else leg?.animation.play();
      }
    },
    dispose: cancel,
  };
}
