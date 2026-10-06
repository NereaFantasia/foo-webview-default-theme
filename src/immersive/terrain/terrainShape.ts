import type { BinsFrame } from '../spectrum/spectrumBins.ts';
import { boxSmooth, compressionExponent, headTaper, peakAverage } from './terrainFilters.ts';

/**
 * 山脊图自己的整形链，逐段取自 musicvid.org LineBed 的 `SpectrumAnalyser`
 * 缺省链：宿主的 FFT 频点（dB 功率）按幂 2.5 的频率轴取点 → −100…−10 dB 铺成 0…1 →
 * 头 7 点衰减 → 箱形平滑 → 按频率从 6 次幂过渡到 3 次幂压平弱的只留峰（逐点的几步在 `terrainFilters.ts`）。
 * 与它的出入：峰保留邻均会把一点宽的谷填掉 3/4，关着；箱形从 9 × 3 收到 5 × 1（见 `TERRAIN_SMOOTH_WINDOW`）；
 * 频率取到 16 kHz 而不是它的 1.75 kHz，高频另按倍频程抬升。图纸上的频谱柱不走这条链。
 */

/** 频率轴的起点（Hz）。 */
export const TERRAIN_MIN_HZ = 20;
/**
 * 显示的最高频率。有损文件多在 16 kHz 附近被截掉，再往上是一段永远的平线，所以不取到 20 kHz。
 * 取到这里，最活跃的低频被挤到左侧：SUB 与 BASS 落在屏宽前 18%，窗口比版心宽时就在封面左边。
 */
export const TERRAIN_MAX_HZ = 16000;
/**
 * 频率轴：LineBed `spectrumScale 2.5`——点 i 落在 `20 + (TERRAIN_MAX_HZ − 20) · (i / N)^2.5` Hz，
 * 线性频率上的幂曲线，比对数轴更偏低频。
 */
export const TERRAIN_AXIS_EXPONENT = 2.5;
/**
 * 高频抬升：音乐的能量越往高频越弱，不补右半边是平的。支点以下不动，往上每倍频程抬 `TERRAIN_TILT_DB_PER_OCTAVE`；
 * 支点取 1 kHz，LineBed 覆盖的 1.75 kHz 以下最多只抬约 2.4 dB，这一段的形状与它基本一样。
 */
export const TERRAIN_TILT_PIVOT_HZ = 1000;
export const TERRAIN_TILT_DB_PER_OCTAVE = 3;
/** 帧间保留量（60 Hz 一帧）：LineBed `smoothingTimeConstant 0.03`，几乎不混，跟手靠 16384 长窗自带的惯性。 */
export const TERRAIN_RETENTION_PER_60HZ = 0.03;
/**
 * 箱形平滑。LineBed `smoothingPoints 9` × `smoothingPasses 3` 落在它 86 个顶点上是 3 个顶点宽（约 20 px）；
 * 这里链输出 384 点（每点一个顶点）铺 1280 px，5 点一遍约 17 px。
 * 窗口按点数定、不随顶点数按屏宽换算：顶点加密是为了让低频的窄峰少被摊平，换算回同样屏宽就白加了。
 */
export const TERRAIN_SMOOTH_WINDOW = 5;
export const TERRAIN_SMOOTH_PASSES = 1;
/** 峰保留邻均（LineBed `averageTransform`）：一点宽的谷会被填掉 3/4，沟壑要留，关着。 */
export const TERRAIN_PEAK_AVERAGE = false;
/** 电平铺满区间：LineBed `minDecibel −100` / `maxDecibel −10`，也是 AnalyserNode 的缺省。 */
export const TERRAIN_FLOOR_DB = -100;
export const TERRAIN_CEIL_DB = -10;

/** `hz` 处的高频抬升，dB；支点以下为 0。 */
export const tiltDb = (hz: number): number =>
  hz > TERRAIN_TILT_PIVOT_HZ
    ? TERRAIN_TILT_DB_PER_OCTAVE * Math.log2(hz / TERRAIN_TILT_PIVOT_HZ)
    : 0;

export const levelOf = (db: number): number =>
  Math.min(1, Math.max(0, (db - TERRAIN_FLOOR_DB) / (TERRAIN_CEIL_DB - TERRAIN_FLOOR_DB)));

/** 第 `index` 点（共 `points` 点）的频率：幂 2.5 轴，首点 20 Hz、末点 `TERRAIN_MAX_HZ`。 */
export const pointHz = (index: number, points: number): number =>
  TERRAIN_MIN_HZ +
  (TERRAIN_MAX_HZ - TERRAIN_MIN_HZ) * (index / Math.max(1, points - 1)) ** TERRAIN_AXIS_EXPONENT;

/** `pointHz` 反过来：频率 `hz` 在横轴上的位置，0 是首点、1 是末点，超出两端夹住。 */
export const axisPositionOf = (hz: number): number =>
  Math.min(1, Math.max(0, (hz - TERRAIN_MIN_HZ) / (TERRAIN_MAX_HZ - TERRAIN_MIN_HZ))) **
  (1 / TERRAIN_AXIS_EXPONENT);

/**
 * 一帧宿主频点变成山脊图的一行。每点按 `pointHz` 定频率，管到与左右相邻点的中点为止：
 * 这段频率里有频点就取其中最大的一个——点比频点稀的中高频是跳着取，和 LineBed 直接从 FFT bin 里取一样
 * 不做均值、毛刺照留，取最大值则不会随频点落在哪一侧来回闪；点比频点密的低频（16384 点、44.1 kHz 下约
 * 55 Hz 以下）一段里没有频点，就在夹着它的两个频点之间按频率线性插值。
 * 再（可选）峰保留邻均、头部衰减、箱形平滑、幂压缩。
 */
export function shapeTerrainFrame(
  frame: BinsFrame,
  out: Float32Array,
  scratch: Float32Array,
): void {
  const { values, firstBin, binHz } = frame;
  const count = values.length;
  const points = out.length;
  if (count === 0 || points === 0) {
    out.fill(0);
    return;
  }
  const levelAt = (bin: number, tilt: number): number => levelOf((values[bin] ?? -Infinity) + tilt);
  let previousHz = pointHz(0, points);
  let hz = previousHz;
  for (let index = 0; index < points; index += 1) {
    const nextHz = index + 1 < points ? pointHz(index + 1, points) : hz;
    const tilt = tiltDb(hz);
    // 这一点管的频点：中心频率落在 [左中点, 右中点) 里的那些，序号换成数组下标。
    const first = Math.max(0, Math.ceil((previousHz + hz) / 2 / binHz) - firstBin);
    const last = Math.min(count - 1, Math.ceil((hz + nextHz) / 2 / binHz) - 1 - firstBin);
    if (first <= last) {
      let peak = values[first] ?? -Infinity;
      for (let bin = first + 1; bin <= last; bin += 1) peak = Math.max(peak, values[bin] ?? peak);
      out[index] = levelOf(peak + tilt);
    } else {
      const position = Math.min(count - 1, Math.max(0, hz / binHz - firstBin));
      const lower = Math.floor(position);
      const upper = Math.min(count - 1, lower + 1);
      const fraction = position - lower;
      out[index] = levelAt(lower, tilt) * (1 - fraction) + levelAt(upper, tilt) * fraction;
    }
    previousHz = hz;
    hz = nextHz;
  }
  if (TERRAIN_PEAK_AVERAGE) peakAverage(out, scratch);
  headTaper(out);
  boxSmooth(out, TERRAIN_SMOOTH_WINDOW, TERRAIN_SMOOTH_PASSES, scratch);
  for (let index = 0; index < points; index += 1) {
    out[index] = (out[index] ?? 0) ** compressionExponent(index, points);
  }
}
