import { axisPositionOf, TERRAIN_MAX_HZ } from './terrainShape.ts';

/**
 * 山脊图底边的频段标尺。山脊图按透视画：最近一行铺满全宽，往后的行逐行收窄、居中，
 * 所以横向位置只有最近一行对得上，标尺只放底边。
 *
 * 以频段名为主、不标 Hz 数字：右栏频谱柱的横轴是 20 Hz 到 Nyquist 的对数轴，与山脊图的幂 2.5 轴不是一套，
 * 同一屏上出现两个位置不同的「1K」会让人以为标错了。
 */

export interface NamedBand {
  label: string;
  /** 频段两端，Hz。 */
  from: number;
  to: number;
}

/** 常用的频段划分，截到山脊图的上限 `TERRAIN_MAX_HZ`。 */
export const TERRAIN_NAMED_BANDS: readonly NamedBand[] = [
  { label: 'SUB', from: 20, to: 60 },
  { label: 'BASS', from: 60, to: 250 },
  { label: 'LOW-MID', from: 250, to: 500 },
  { label: 'MID', from: 500, to: 2000 },
  { label: 'HIGH-MID', from: 2000, to: 6000 },
  { label: 'HIGH', from: 6000, to: TERRAIN_MAX_HZ },
];

export interface RulerSegment {
  label: string;
  /** 占屏宽的比例，0…1。 */
  left: number;
  width: number;
}

export function rulerSegments(bands: readonly NamedBand[] = TERRAIN_NAMED_BANDS): RulerSegment[] {
  return bands.map(({ label, from, to }) => {
    const left = axisPositionOf(from);
    return { label, left, width: axisPositionOf(to) - left };
  });
}

/** 频段之间的分界位置（屏宽比例）；两端就是视口边缘，不另画刻度。 */
export function rulerTicks(bands: readonly NamedBand[] = TERRAIN_NAMED_BANDS): number[] {
  return bands
    .slice(1)
    .map((band) => axisPositionOf(band.from))
    .filter((position) => position > 0 && position < 1);
}
