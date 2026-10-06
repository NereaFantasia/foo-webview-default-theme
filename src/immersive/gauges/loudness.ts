import { ABSOLUTE_GATE_LUFS } from './loudnessMeter.ts';

/**
 * 图纸量表的四个读数与值条比例。DR 按 TT DR Meter 从整轨解码算（`drMeter.ts`）；响度按 BS.1770（`loudnessMeter.ts`）：
 * Short-term 与 Momentary 来自实时流，Integrated 来自整轨解码。
 */
export interface GaugeReadings {
  dynamicRange: number | null;
  /** 大数字，LUFS。 */
  shortTerm: number | null;
  /** 值条，LUFS。 */
  momentary: number | null;
  /** 小标行右端，LUFS。 */
  integrated: number | null;
}

export const NO_READINGS: GaugeReadings = {
  dynamicRange: null,
  shortTerm: null,
  momentary: null,
  integrated: null,
};

/** 值条满刻：DR 0 … 20；响度 −40 … 0 LUFS，越响越长。 */
export const DR_FULL_SCALE = 20;
export const LUFS_FLOOR = -40;
export const LUFS_CEIL = 0;

/** 轨下的刻度与刻度字（原单位）：DR 每 5 一刻、响度每 10 一刻，字只写两端与中点，与相关条一样三处。 */
export const DR_TICKS = [0, 5, 10, 15, 20];
export const DR_LABELS = [0, 10, 20];
export const LUFS_TICKS = [-40, -30, -20, -10, 0];
export const LUFS_LABELS = [-40, -20, 0];

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/** 值条长度占满刻的比例（0…1）。 */
export const dynamicRangeFraction = (dr: number): number => clampUnit(dr / DR_FULL_SCALE);

export const loudnessFraction = (lufs: number): number =>
  clampUnit((lufs - LUFS_FLOOR) / (LUFS_CEIL - LUFS_FLOOR));

/** 不高于绝对门限（含静音）的响度按没有值写：那一段 BS.1770 自己也不计。 */
export const audibleLufs = (lufs: number | null): number | null =>
  lufs !== null && lufs > ABSOLUTE_GATE_LUFS ? lufs : null;
