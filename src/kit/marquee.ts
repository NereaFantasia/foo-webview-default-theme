import { DURATION_MS } from '../motion/timing.ts';

/**
 * 超长文本单行循环滚动排版模型
 *
 * 支持两种滚动策略：
 * 1. 默认单向回弹滚动：起始停顿后匀速向左滚动至末尾对齐，短暂驻留后淡出复位并重新开始；
 * 2. 传送带无缝滚动：首尾衔接双份文本，连续左移一个循环周期后平滑复位（参见 conveyorCycle）；
 * 时间单位为毫秒，位移单位为像素
 */

export const MARQUEE_REST_MS = 3000;
export const MARQUEE_END_MS = 1500;
/** 滚动速度，CSS 像素每秒：播放栏的字 12–14，这个速度读得过来 */
export const MARQUEE_SPEED = 36;
/** `MARQUEE_SPEED` 是按这个字号定的；更大的字按字号等比加快，一秒里读过的字数才不变 */
const MARQUEE_REFERENCE_FONT_PX = 13;

/** 字号为 `fontPx` 的一行字的滚动速度，CSS 像素每秒；不小于播放栏那一档 */
export function marqueeSpeedFor(fontPx: number): number {
  return Math.max(MARQUEE_SPEED, (MARQUEE_SPEED * fontPx) / MARQUEE_REFERENCE_FONT_PX);
}
/** 只差这么一点时不滚，渐隐已经够了 */
export const MARQUEE_MIN_OVERFLOW = 2;
/** 渐隐的宽，与 `TruncatedText.module.css` 里放不下时的那一截相同 */
export const FADE_PX = 24;

/** 相邻两帧遮罩之间的间隔：遮罩不能插值，挨得这么近就等于在这一刻直接换 */
const SWITCH = 1e-4;

/** 三种遮罩：没滚时只淡右缘，滚动中两边都淡，滚到尾只淡左缘。遮罩只看不透明度 */
export const MARQUEE_MASKS = {
  right: `linear-gradient(to right, black calc(100% - ${FADE_PX}px), transparent)`,
  both: `linear-gradient(to right, transparent, black ${FADE_PX}px, black calc(100% - ${FADE_PX}px), transparent)`,
  left: `linear-gradient(to right, transparent, black ${FADE_PX}px)`,
} as const;

/** 传送带里左缘渐隐的宽，由动画推它：不滚时是 0，滚动中是 `FADE_PX`（`TruncatedText.module.css` 注册了这个属性） */
export const MARQUEE_LEFT_FADE = '--marquee-left';

export interface MarqueeCycle {
  /** 停顿之后那一段动画的时长：滚动、末尾停顿、淡出淡入 */
  readonly duration: number;
  /** 给字本身：位移与淡出淡入 */
  readonly text: Keyframe[];
  /** 给裁切字的那一层：随滚动换遮罩 */
  readonly mask: Keyframe[];
}

/**
 * `overflow` 是字比裁切层宽出的部分；不到 `MARQUEE_MIN_OVERFLOW` 时不滚，答 null。`speed` 是滚动速度，
 * CSS 像素每秒，缺省是播放栏那一档
 */
export function marqueeCycle(overflow: number, speed = MARQUEE_SPEED): MarqueeCycle | null {
  if (!(overflow >= MARQUEE_MIN_OVERFLOW)) return null;
  const fade = DURATION_MS.faster;
  const scroll = (overflow / speed) * 1000;
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

/**
 * 传送带无缝双份文本循环滚动关键帧生成器
 *
 * 文本后衔接副本并整体左移 loop 距离以实现无缝循环；位移过渡期间动态调节左缘渐隐遮罩，
 * 循环复位时与静态遮罩平滑接合避免闪烁；loop 非正数时返回 null
 */
export function conveyorCycle(loop: number, speed = MARQUEE_SPEED): MarqueeCycle | null {
  if (!(loop > 0)) return null;
  const duration = (loop / speed) * 1000;
  const ramp = Math.min(DURATION_MS.normal / duration, 0.5);
  return {
    duration,
    text: [
      { offset: 0, transform: 'translateX(0)' },
      { offset: 1, transform: `translateX(${-loop}px)` },
    ],
    mask: [
      { offset: 0, [MARQUEE_LEFT_FADE]: '0px' },
      { offset: ramp, [MARQUEE_LEFT_FADE]: `${FADE_PX}px` },
      { offset: 1 - ramp, [MARQUEE_LEFT_FADE]: `${FADE_PX}px` },
      { offset: 1, [MARQUEE_LEFT_FADE]: '0px' },
    ],
  };
}
