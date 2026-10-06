import { FOLD_CLOSE, FOLD_OPEN } from '../../motion/foldMotion.ts';
import { CURVE, DURATION_MS, motionDuration } from '../../motion/timing.ts';

/** 页内区域那一档的位移，像素。 */
const RISE_PX = 20;

/**
 * 菜单打开：块折叠的展开。框不动、只当裁剪，里面的内容从框的上方滑下来，333 ms 直接进场。
 * `frame` 要裁掉溢出的部分。
 */
export function unfoldMenu(frame: HTMLElement, content: HTMLElement, reduced: boolean): void {
  content.animate([{ transform: `translateY(${-frame.offsetHeight}px)` }, { transform: 'none' }], {
    duration: motionDuration(FOLD_OPEN.duration, reduced),
    easing: FOLD_OPEN.curve.timing,
  });
}

/** 菜单收起：内容滑回框的上方，167 ms 折叠收起；播完停在收起的位置，由调用方卸下。 */
export function foldMenu(frame: HTMLElement, content: HTMLElement, reduced: boolean): Animation {
  return content.animate(
    [{ transform: 'none' }, { transform: `translateY(${-frame.offsetHeight}px)` }],
    {
      duration: motionDuration(FOLD_CLOSE.duration, reduced),
      easing: FOLD_CLOSE.curve.timing,
      fill: 'forwards',
    },
  );
}

/** 换了版式后新到位的几块：上移 20 px，250 ms 直接进场，配 83 ms 线性淡入。 */
export function riseIn(parts: readonly HTMLElement[], reduced: boolean): void {
  for (const part of parts) {
    part.getAnimations().forEach((animation) => animation.cancel());
    part.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration(DURATION_MS.faster, reduced),
      easing: CURVE.linear.timing,
    });
    part.animate([{ transform: `translateY(${RISE_PX}px)` }, { transform: 'none' }], {
      duration: motionDuration(DURATION_MS.normal, reduced),
      easing: CURVE.decelerateMid.timing,
    });
  }
}

/** 原位 83 ms 线性淡入；先撤掉这几块上一段停在终态的淡出。 */
export function fadeIn(parts: readonly HTMLElement[], reduced: boolean): void {
  for (const part of parts) {
    part.getAnimations().forEach((animation) => animation.cancel());
    part.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration(DURATION_MS.faster, reduced),
      easing: CURVE.linear.timing,
    });
  }
}

/** 83 ms 线性淡出，停在透明；调用方在换回版式后用 `fadeIn` 或撤销动画让它们重新出现。 */
export function fadeOut(parts: readonly HTMLElement[], reduced: boolean): Animation[] {
  return parts.map((part) =>
    part.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: motionDuration(DURATION_MS.faster, reduced),
      easing: CURVE.linear.timing,
      fill: 'forwards',
    }),
  );
}
