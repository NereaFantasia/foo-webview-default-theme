import {
  mergeOptions,
  type OptionSchema,
  type OptionValues,
  type StoredOptions,
} from '../../scene/presetOptions.ts';
import type { BleedLook } from '../../bleed-cover/BleedCover.tsx';
import type { LayoutOptions } from './bleedLayout.ts';

/**
 * 预设 2「满幅封面」的可调项：声明与存档用界面单位（滑块是几就存几），缺省值就是 nereal 定稿的取值。
 * 存档键是持久化契约，已发布的不改名；改格式换新键。羽化的终点由起点加宽度算出（`bleed-cover/feather.ts`），
 * 所以不存终点，三者的先后次序天然成立
 */
export const BLEED_SCHEMA = {
  /** 封面占窗宽的比例 */
  coverWidth: { kind: 'range', min: 50, max: 70, step: 1, default: 58 },
  /** 右栏从窗宽的多少起 */
  sideStart: { kind: 'range', min: 44, max: 56, step: 1, default: 50 },
  /** 封面往左伸出窗外多少，窗宽的百分数；居中时不用 */
  coverShift: { kind: 'range', min: 0, max: 15, step: 1, default: 0 },
  coverZoom: { kind: 'range', min: 100, max: 150, step: 5, default: 100 },
  focusX: { kind: 'range', min: 0, max: 100, step: 1, default: 42 },
  focusY: { kind: 'range', min: 0, max: 100, step: 1, default: 50 },
  feather: { kind: 'switch', default: true },
  featherStart: { kind: 'range', min: 20, max: 60, step: 1, default: 38 },
  featherWidth: { kind: 'range', min: 20, max: 60, step: 1, default: 42 },
  /** 羽化浓度，存百分数：140 就是系数 1.4 */
  featherHold: { kind: 'range', min: 100, max: 200, step: 5, default: 140 },
  blur: { kind: 'range', min: 0, max: 16, step: 1, default: 7 },
  scrimHeight: { kind: 'range', min: 0, max: 40, step: 1, default: 26 },
  scrimStrength: { kind: 'range', min: 0, max: 80, step: 1, default: 50 },
  capsuleOpen: { kind: 'switch', default: false },
  capsuleWidth: { kind: 'range', min: 360, max: 520, step: 10, default: 440 },
  capsuleBottom: { kind: 'range', min: 24, max: 64, step: 2, default: 36 },
} as const satisfies OptionSchema;

export type BleedOptions = OptionValues<typeof BLEED_SCHEMA>;

/** 存档合并缺省，没有存档就是全缺省 */
export function bleedOptionsOf(stored: StoredOptions | undefined): BleedOptions {
  return mergeOptions(BLEED_SCHEMA, stored ?? {});
}

/** 版式要的那几项 */
export function layoutOptionsOf(options: BleedOptions): LayoutOptions {
  return {
    coverWidth: options.coverWidth,
    sideStart: options.sideStart,
    coverShift: options.coverShift,
    capsuleWidth: options.capsuleWidth,
    capsuleBottom: options.capsuleBottom,
  };
}

/** 满幅封面元素要的外观参数 */
export function lookOf(options: BleedOptions): BleedLook {
  return {
    featherStart: options.featherStart,
    featherWidth: options.featherWidth,
    hold: options.featherHold / 100,
    blur: options.blur,
    scrimHeight: options.scrimHeight,
    scrimStrength: options.scrimStrength,
    zoom: options.coverZoom,
    focusX: options.focusX,
    focusY: options.focusY,
  };
}
