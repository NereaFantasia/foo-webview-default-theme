/**
 * 图纸频谱柱的数值部分，纯函数。
 *
 * 共享缓冲就是 200 根柱的柱高（0…1），由宿主频点按柱的横轴并成（`spectrumBins.ts` 的 `barsOfBins`）；
 * `groupBands` 把任意列数的缓冲按最大值并成柱，列数与柱数相同时逐根照抄。中频乐器的谐波是一根根窄峰，
 * 相邻列求均值会被峰间的谷拉平，平均成一片平台就分不出乐器了，所以取最大值。帧间的平滑归写缓冲的一方，
 * 这里只再加一层下落平滑——起音瞬到、回落按固定比例衰减，柱顶才不会一帧一帧地抖。
 * 柱本身不做峰值保持，柱顶上方的峰值点另由 `settlePeaks` 走。
 */
export const SPECTRUM_BARS = 200;
/**
 * 带值（带内频点功率之和，dB）换成柱高的上下限：这一段线性铺满柱区，之外夹到底或顶。
 * 顶取 0 dB、往下 60 dB，纵轴从 0 标起。实测在播音乐全频 5% 到 95% 分位约 −64 到 −20 dB、峰值到 −12，
 * 所以柱顶一格常空着，最弱的几带落到底。
 */
export const BARS_DB_FLOOR = -60;
export const BARS_DB_CEIL = 0;
/** 柱与柱之间的空隙（CSS 像素）。 */
export const BAR_GAP = 1;
/**
 * 下落平滑：每 1/30 s 保留上一刻柱高的这么多，回落的时间常数约 28 ms——柱子只显示当下，
 * 落得慢会让上一刻的峰把这一刻的谷填上；连贯感交给峰值点（`settlePeaks`）。
 * canvas 按显示刷新率重画、宿主也可能限流到 12 fps，所以按实际经过的时间折算，不按帧数。系数是经验值。
 */
export const RELEASE_PER_30HZ = 0.3;
const RELEASE_FRAME_MS = 1000 / 30;

/** 过了 `deltaMs` 毫秒后上一刻柱高还保留多少；非正的时长不衰减。 */
export function releaseFor(deltaMs: number): number {
  return deltaMs > 0 ? RELEASE_PER_30HZ ** (deltaMs / RELEASE_FRAME_MS) : 1;
}

/**
 * 断点（seek、手动换曲、从无到有）之后的一段时间里起音不瞬到：每一刻补上离目标差距的这么多，
 * 时间常数取时长的三分之一，到时长末约补上 95%。它不会自己回到 1：过了时长照常瞬到要由调用方改传 1。
 * `windowMs` 不大于 0 时直接是 1。
 */
export function attackFor(deltaMs: number, windowMs: number): number {
  if (!(windowMs > 0)) return 1;
  return 1 - Math.exp((-3 * Math.max(0, deltaMs)) / windowMs);
}

/** 一带的 dB 值换成柱高（0…1）。 */
export function levelOfDb(db: number): number {
  const level = (db - BARS_DB_FLOOR) / (BARS_DB_CEIL - BARS_DB_FLOOR);
  return level > 0 ? Math.min(level, 1) : 0;
}

/** 一帧的带值（dB）逐个换成柱高。 */
export function levelsOfDb(frame: ArrayLike<number>): Float32Array {
  return Float32Array.from(frame, levelOfDb);
}

/**
 * 把一帧的带并成 `out.length` 根柱：第 i 根取 `[i·n/m, (i+1)·n/m)` 里的带的最大值，
 * 带数不是柱数的整数倍时每根取 ⌊n/m⌋ 到 ⌈n/m⌉ 个带；带比柱少时一根至少取一个带。输入是 0…1 的柱高，
 * 最大值从 0 起取，负值按 0 算。
 */
export function groupBands(frame: ArrayLike<number>, out: Float32Array): void {
  const bands = frame.length;
  const bars = out.length;
  if (bands === 0) {
    out.fill(0);
    return;
  }
  for (let bar = 0; bar < bars; bar += 1) {
    const start = Math.min(Math.floor((bar * bands) / bars), bands - 1);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * bands) / bars));
    let peak = 0;
    for (let band = start; band < end; band += 1) {
      const value = frame[band] ?? 0;
      if (value > peak) peak = value;
    }
    out[bar] = peak;
  }
}

/**
 * 柱高向目标走一步：比目标低时补上差距的 `attack`（缺省 1，即起音瞬到），比目标高按 `retention` 衰减，但不低于目标。
 * `retention` 为 0 就是直接跟随（减弱动效）。返回是否还有柱没落到目标，即还要不要再画下一刻。
 */
export function settleBars(
  levels: Float32Array,
  target: Float32Array,
  retention: number,
  attack = 1,
): boolean {
  let moving = false;
  for (let index = 0; index < levels.length; index += 1) {
    const goal = target[index] ?? 0;
    const level = levels[index] ?? 0;
    const decayed = level * retention;
    let next = decayed > goal ? decayed : goal;
    if (goal > level) next = level + (goal - level) * attack;
    // 离目标只差柱区高度的千分之一，肉眼看不出，直接落到目标，免得为它一直重画。
    levels[index] = Math.abs(next - goal) < 1e-3 ? goal : next;
    if (levels[index] !== goal) moving = true;
  }
  return moving;
}

/** 峰值点：柱顶冲上来就跟上，停这么久（毫秒）再往下落。 */
export const PEAK_HOLD_MS = 500;
/** 峰值点下落的速度：每秒落这么多柱区高度。 */
export const PEAK_FALL_PER_S = 0.5;

/**
 * 峰值点走一步：柱高不低于峰值点时峰值点跟上并重新计时，停够 `PEAK_HOLD_MS` 后按 `PEAK_FALL_PER_S` 匀速下落，
 * 不低于柱高。`heldUntil` 是各点停到哪一刻（毫秒）。返回是否还有点高于柱，即还要不要再画下一刻。
 */
export function settlePeaks(
  peaks: Float32Array,
  heldUntil: Float64Array,
  levels: Float32Array,
  now: number,
  deltaMs: number,
): boolean {
  let moving = false;
  const fall = (PEAK_FALL_PER_S * Math.max(0, deltaMs)) / 1000;
  for (let index = 0; index < peaks.length; index += 1) {
    const level = levels[index] ?? 0;
    const peak = peaks[index] ?? 0;
    if (level >= peak) {
      peaks[index] = level;
      heldUntil[index] = now + PEAK_HOLD_MS;
    } else if (now >= (heldUntil[index] ?? 0)) {
      peaks[index] = Math.max(level, peak - fall);
    }
    if ((peaks[index] ?? 0) > level) moving = true;
  }
  return moving;
}

/** 柱宽：版心 600 宽、200 根、空隙 1 px 时约 2 px。 */
export function barWidth(width: number, bars = SPECTRUM_BARS, gap = BAR_GAP): number {
  return Math.max(0, (width - (bars - 1) * gap) / bars);
}
