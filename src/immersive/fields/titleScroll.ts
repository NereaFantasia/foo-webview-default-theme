import { SHEET_WIDTH } from '../paper/paperLayout.ts';

/**
 * 图纸长标题的擦除滚动节奏，照 catbot-3 网页版：
 * 停 3 s → 匀速滚到尾 → 停 0.7 s → 擦除从左到右盖住标题 → 标题复位 → 再从左到右擦开，然后从头循环。
 * 时间单位秒、长度 CSS 像素；这里只算某一刻滚了多少、擦到哪，怎么画归调用方。
 */

export const TITLE_HOLD_SECONDS = 3;
/** 网页版的 80 px/s 按 1920 宽的页面给，这里按版心宽换算。 */
export const TITLE_SCROLL_SPEED = (80 * SHEET_WIDTH) / 1920;
export const TITLE_END_HOLD_SECONDS = 0.7;
export const TITLE_WIPE_SECONDS = 0.45;
/** 擦除边缘的软边：网页版 96 按版心宽换算；标题很窄时不超过宽度的 35%。 */
export const TITLE_WIPE_SOFTNESS = (96 * SHEET_WIDTH) / 1920;
const SOFTNESS_MAX_RATIO = 0.35;

export interface TitleScrollPhases {
  /** 各段的结束时刻，从一轮开始算。 */
  scrollEnd: number;
  holdEnd: number;
  coverEnd: number;
  /** 一轮的总长，也是擦开那一段的结束时刻。 */
  cycle: number;
}

/** 版心档的速度与软边按版心宽换算过；full 档的舞台照网页版原值另给。 */
export function titleScrollPhases(
  overflow: number,
  speed: number = TITLE_SCROLL_SPEED,
): TitleScrollPhases {
  const scrollEnd = TITLE_HOLD_SECONDS + Math.max(0, overflow) / speed;
  const holdEnd = scrollEnd + TITLE_END_HOLD_SECONDS;
  const coverEnd = holdEnd + TITLE_WIPE_SECONDS;
  return { scrollEnd, holdEnd, coverEnd, cycle: coverEnd + TITLE_WIPE_SECONDS };
}

export interface TitleWipe {
  /** `cover` 从左到右盖住标题，`reveal` 从左到右擦开。 */
  kind: 'cover' | 'reveal';
  /** 0…1。 */
  progress: number;
}

export interface TitleScrollFrame {
  /** 标题左移的距离。 */
  offset: number;
  /** 不在擦除段时为 null。 */
  wipe: TitleWipe | null;
}

const STILL: TitleScrollFrame = { offset: 0, wipe: null };

/** 开始滚动后 `elapsed` 秒这一刻的偏移与擦除；`overflow` 是标题比容器宽出的部分，不超宽时恒为静止。 */
export function titleScrollAt(
  elapsed: number,
  overflow: number,
  speed: number = TITLE_SCROLL_SPEED,
): TitleScrollFrame {
  if (!(overflow > 0) || !Number.isFinite(elapsed)) return STILL;
  const { scrollEnd, holdEnd, coverEnd, cycle } = titleScrollPhases(overflow, speed);
  const phase = ((elapsed % cycle) + cycle) % cycle;
  if (phase < TITLE_HOLD_SECONDS) return STILL;
  if (phase < scrollEnd) {
    return { offset: (phase - TITLE_HOLD_SECONDS) * speed, wipe: null };
  }
  if (phase < holdEnd) return { offset: overflow, wipe: null };
  if (phase < coverEnd) {
    return {
      offset: overflow,
      wipe: { kind: 'cover', progress: (phase - holdEnd) / TITLE_WIPE_SECONDS },
    };
  }
  return { offset: 0, wipe: { kind: 'reveal', progress: (phase - coverEnd) / TITLE_WIPE_SECONDS } };
}

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

/**
 * 擦除这一刻给标题容器的 `mask-image`：透明处标题隐去、露出底下的纸面，不透明处照常显示，软边是两者之间的渐变。
 * 盖住时边缘从左外一个软边宽走到右缘，擦开时从左缘走到右外一个软边宽，两头都不会一下子跳出半截软边。
 * 不在擦除段时返回空串，调用方据此撤掉遮罩。
 */
export function wipeMask(
  wipe: TitleWipe | null,
  width: number,
  softness: number = TITLE_WIPE_SOFTNESS,
): string {
  if (!wipe) return '';
  const soft = Math.min(softness, width * SOFTNESS_MAX_RATIO);
  const progress = Math.min(1, Math.max(0, wipe.progress));
  if (wipe.kind === 'cover') {
    const edge = -soft + (width + soft) * progress;
    return `linear-gradient(to right, transparent ${px(edge)}, black ${px(edge + soft)})`;
  }
  const edge = (width + soft) * progress;
  return `linear-gradient(to right, black ${px(edge - soft)}, transparent ${px(edge)})`;
}

/**
 * 标题放不下时降到的字号：从 `max` 每次降 `step`，取第一个放得下的，最低 `min`。按字宽与字号成正比估，
 * 不逐档试排；估出的字号仍放不下时由调用方接着滚动。`natural` 是按 `max` 排出的宽，`available` 是容器宽。
 */
export function fittedFontSize(
  available: number,
  natural: number,
  font: { max: number; min: number; step: number },
): number {
  if (!(natural > available) || !(available > 0)) return font.max;
  const ideal = (font.max * available) / natural;
  const steps = Math.ceil((font.max - ideal) / font.step);
  return Math.max(font.min, font.max - steps * font.step);
}
