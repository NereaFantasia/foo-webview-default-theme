import { DURATION_MS } from '../../motion/timing.ts';

/**
 * 播放栏里放不下的一行字定时向左滚动一遍：停 `MARQUEE_REST_MS` → 匀速滚到末尾对齐右缘 → 停
 * `MARQUEE_END_MS` → 淡出、回到开头、淡入，然后从头循环。开头那一段停顿不放动画，由调用方计时
 * （`useMarquee`），这段时间里渐隐由样式表给；这里只算停顿之后那一段的关键帧。时间单位毫秒，长度 CSS 像素。
 */

export const MARQUEE_REST_MS = 3000;
export const MARQUEE_END_MS = 1500;
/** 滚动速度，CSS 像素每秒：播放栏的字 12–14，这个速度读得过来。 */
export const MARQUEE_SPEED = 36;
/** 只差这么一点时不滚，渐隐已经够了。 */
export const MARQUEE_MIN_OVERFLOW = 2;
/** 渐隐的宽，与 `TruncatedText.module.css` 里放不下时的那一截相同。 */
export const FADE_PX = 24;

/** 相邻两帧遮罩之间的间隔：遮罩不能插值，挨得这么近就等于在这一刻直接换。 */
const SWITCH = 1e-4;

/** 三种遮罩：没滚时只淡右缘，滚动中两边都淡，滚到尾只淡左缘。遮罩只看不透明度。 */
export const MARQUEE_MASKS = {
  right: `linear-gradient(to right, black calc(100% - ${FADE_PX}px), transparent)`,
  both: `linear-gradient(to right, transparent, black ${FADE_PX}px, black calc(100% - ${FADE_PX}px), transparent)`,
  left: `linear-gradient(to right, transparent, black ${FADE_PX}px)`,
} as const;

export interface MarqueeCycle {
  /** 停顿之后那一段动画的时长：滚动、末尾停顿、淡出淡入。 */
  readonly duration: number;
  /** 给字本身：位移与淡出淡入。 */
  readonly text: Keyframe[];
  /** 给裁切字的那一层：随滚动换遮罩。 */
  readonly mask: Keyframe[];
}

/** `overflow` 是字比裁切层宽出的部分；不到 `MARQUEE_MIN_OVERFLOW` 时不滚，答 null。 */
export function marqueeCycle(overflow: number): MarqueeCycle | null {
  if (!(overflow >= MARQUEE_MIN_OVERFLOW)) return null;
  const fade = DURATION_MS.faster;
  const scroll = (overflow / MARQUEE_SPEED) * 1000;
  const duration = scroll + MARQUEE_END_MS + 2 * fade;
  const at = (ms: number) => ms / duration;
  const moved = `translateX(${-overflow}px)`;
  const scrollEnd = at(scroll);
  const fadeStart = at(scroll + MARQUEE_END_MS);
  const reset = at(scroll + MARQUEE_END_MS + fade);
  return {
    duration,
    text: [
      { offset: 0, transform: 'translateX(0)', opacity: 1 },
      { offset: scrollEnd, transform: moved },
      { offset: fadeStart, transform: moved, opacity: 1 },
      { offset: reset, transform: moved, opacity: 0 },
      { offset: reset, transform: 'translateX(0)', opacity: 0 },
      { offset: 1, transform: 'translateX(0)', opacity: 1 },
    ],
    mask: [
      { offset: 0, maskImage: MARQUEE_MASKS.both },
      { offset: scrollEnd, maskImage: MARQUEE_MASKS.both },
      { offset: scrollEnd + SWITCH, maskImage: MARQUEE_MASKS.left },
      { offset: reset, maskImage: MARQUEE_MASKS.left },
      { offset: reset + SWITCH, maskImage: MARQUEE_MASKS.right },
      { offset: 1, maskImage: MARQUEE_MASKS.right },
    ],
  };
}
