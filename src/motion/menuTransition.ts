import { CURVE, DURATION_MS, motionDuration } from './timing.ts';
import type { SurfaceTransition } from './surfaceTransition.ts';

/** 底板伸展、视口裁剪与正文位移分开，正文始终按原尺寸绘制 */
export function createMenuTransition(element: HTMLElement, submenu: boolean): SurfaceTransition {
  const backplate = element.querySelector<HTMLElement>('[data-menu-backplate]');
  const viewport = element.querySelector<HTMLElement>('[data-menu-viewport]');
  const content = element.querySelector<HTMLElement>('[data-menu-content]');
  if (!backplate || !viewport || !content) throw new Error('菜单缺少表面层');
  const parts = [backplate, viewport, content];
  const hidden = submenu ? 0.67 : 0.5;
  let animations: Animation[] = [];
  let from = 0;
  let settled = 0;
  let entering = false;
  let generation = 0;

  function frames(value: number): Keyframe[] {
    const away = hidden * (1 - value);
    const direction = 'var(--menu-reveal-direction, -1)';
    return [
      { transform: `scaleY(${1 - away})` },
      {
        clipPath: `inset(calc(max(0, ${direction}) * ${away * 100}%) 0 calc(max(0, calc(-1 * ${direction})) * ${away * 100}%) 0)`,
      },
      { transform: `translateY(calc(${direction} * ${away * 100}%))` },
    ];
  }

  function cancel(): void {
    generation++;
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  return {
    play(visible, reduced) {
      const shape = animations[0];
      const time = typeof shape?.currentTime === 'number' ? shape.currentTime : 0;
      const duration = Number(shape?.effect?.getTiming().duration) || 1;
      const progress =
        entering && shape
          ? from + (1 - from) * CURVE.decelerateMid.ease(Math.min(1, time / duration))
          : settled;
      const initial = animations.length
        ? parts.map((part, index) => {
            const style = getComputedStyle(part);
            return index === 1 ? { clipPath: style.clipPath } : { transform: style.transform };
          })
        : frames(progress);
      const opacity = animations.length ? getComputedStyle(element).opacity : '1';
      cancel();
      const mine = generation;
      entering = visible;
      from = progress;
      settled = progress;
      const end = visible ? frames(1) : initial;
      const ms = motionDuration(
        visible ? DURATION_MS.normal * (1 - progress) : DURATION_MS.faster,
        reduced,
      );
      animations = parts.map((part, index) =>
        part.animate([initial[index]!, end[index]!], {
          duration: ms,
          easing: visible ? CURVE.decelerateMid.timing : CURVE.linear.timing,
          fill: 'both',
        }),
      );
      // 退出途中重开才恢复透明度；首次进入的正文没有淡入
      if (!visible || Number(opacity) < 1)
        animations.push(
          element.animate([{ opacity }, { opacity: visible ? 1 : 0 }], {
            duration: motionDuration(DURATION_MS.faster, reduced),
            easing: CURVE.linear.timing,
            fill: 'both',
          }),
        );
      return Promise.all(animations.map((animation) => animation.finished)).then(
        () => {
          if (mine !== generation) return false;
          if (visible) {
            settled = 1;
            cancel();
          }
          return true;
        },
        () => false,
      );
    },
    jump(visible) {
      cancel();
      entering = false;
      settled = visible ? 1 : 0;
    },
    setPlaybackRate(rate) {
      for (const animation of animations) animation.updatePlaybackRate(rate);
    },
    setPlayState(state) {
      for (const animation of animations) {
        if (state === 'paused') animation.pause();
        else animation.play();
      }
    },
    dispose: cancel,
  };
}
