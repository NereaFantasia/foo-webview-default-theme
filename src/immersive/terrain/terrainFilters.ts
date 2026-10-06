/**
 * 山脊图整形链里逐点改一行的几步，取自 musicvid.org LineBed `SpectrumAnalyser` 的同名变换：峰保留邻均、
 * 头部衰减、箱形平滑、按位置取的幂压缩指数。前三个原地改传进来的 `Float32Array`，调用顺序与开关由
 * `terrainShape.ts` 的 `shapeTerrainFrame` 定。
 */

/**
 * 头部衰减（LineBed `tailTransform` 的 head 侧：`headMargin 7 / headMarginSlope 0.0133 / marginDecay 1.6 /
 * minMarginWeight 0.7`）：前 7 点乘 0.7 起的斜坡，第 7 点回到 1，压掉次低音那一撮。
 */
export const TERRAIN_HEAD_MARGIN = 7;
const HEAD_MARGIN_SLOPE = 0.013334120966221101;
const HEAD_MARGIN_DECAY = 1.6;
const HEAD_MIN_WEIGHT = 0.7;
/** 幂压缩：低频 6 次幂、高频 3 次幂，按平方曲线过渡（LineBed `spectrumMaxExponent / Min / ExponentScale` 缺省）。 */
export const TERRAIN_EXPONENT_LOW = 6;
export const TERRAIN_EXPONENT_HIGH = 3;
export const TERRAIN_EXPONENT_CURVE = 2;

/**
 * 峰保留邻均（LineBed `averageTransform`）两遍：局部极大值原样留，别的点向较高的邻点靠——第一遍
 * 取 (本点 + 高邻) / 2，第二遍取 本点 / 2 + 高邻 / 3 + 低邻 / 6；首点不动，末点与前一点平均。
 * 效果是山脊尖、谷底填，比箱形平滑多保留峰。
 */
export function peakAverage(values: Float32Array, scratch: Float32Array): void {
  const count = values.length;
  if (count < 3) return;
  const last = count - 1;
  const passes: ((current: number, high: number, low: number) => number)[] = [
    (current, high) => (current + high) / 2,
    (current, high, low) => current / 2 + high / 3 + low / 6,
  ];
  for (const blend of passes) {
    scratch[0] = values[0] ?? 0;
    for (let index = 1; index < last; index += 1) {
      const previous = values[index - 1] ?? 0;
      const current = values[index] ?? 0;
      const next = values[index + 1] ?? 0;
      scratch[index] =
        current >= previous && current >= next
          ? current
          : blend(current, Math.max(previous, next), Math.min(previous, next));
    }
    scratch[last] = ((values[last - 1] ?? 0) + (values[last] ?? 0)) / 2;
    values.set(scratch.subarray(0, count));
  }
}

/** 前 `TERRAIN_HEAD_MARGIN` 点乘上 `slope · (i + 1)^decay + 0.7` 的斜坡。 */
export function headTaper(values: Float32Array): void {
  const margin = Math.min(TERRAIN_HEAD_MARGIN, values.length);
  for (let index = 0; index < margin; index += 1) {
    values[index] =
      (values[index] ?? 0) *
      (HEAD_MARGIN_SLOPE * (index + 1) ** HEAD_MARGIN_DECAY + HEAD_MIN_WEIGHT);
  }
}

/** 滑动平均跑 `passes` 遍，边上取不到的点用端点补（LineBed 原样留着两端，边会毛）。 */
export function boxSmooth(
  values: Float32Array,
  window: number,
  passes: number,
  scratch: Float32Array,
): void {
  const half = Math.floor(window / 2);
  const count = values.length;
  if (half === 0 || passes <= 0 || count === 0) return;
  const last = count - 1;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let index = 0; index < count; index += 1) {
      let sum = 0;
      for (let offset = -half; offset <= half; offset += 1) {
        sum += values[Math.min(last, Math.max(0, index + offset))] ?? 0;
      }
      scratch[index] = sum / (2 * half + 1);
    }
    values.set(scratch.subarray(0, count));
  }
}

/** 第 `index` 点（共 `count` 点）的压缩指数；LineBed 按 `i / size` 取位置，末点到不了 3。 */
export function compressionExponent(index: number, count: number): number {
  const t = count > 0 ? index / count : 0;
  const range = TERRAIN_EXPONENT_LOW - TERRAIN_EXPONENT_HIGH;
  return TERRAIN_EXPONENT_HIGH + range * (1 - t ** TERRAIN_EXPONENT_CURVE);
}
