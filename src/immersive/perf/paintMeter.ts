/**
 * 绘制计时：把每次绘制的耗时按统计窗汇总，一窗交一次。山脊图在主线程与 Worker 里画都经这里记，
 * 性能小窗据它显示每秒画几次、每次多久。只量调用方包住的那一段，光栅不在其中。
 */

/** 统计窗长（毫秒）：性能小窗按它刷新，数字看得清，也跟得上变化。 */
export const METER_WINDOW_MS = 500;

export interface PaintStats {
  /** 这一窗画了几次。 */
  paints: number;
  /** 各次耗时之和与最长的一次（毫秒）。 */
  totalMs: number;
  maxMs: number;
  /** 这一窗实际跨了多久（毫秒），换算每秒次数用。 */
  spanMs: number;
}

export interface PaintMeter {
  /** 记一次绘制；两个时刻取自同一个时钟。 */
  record(startedAt: number, endedAt: number): void;
}

/** 一窗从上一窗交出的时刻算起，头一窗从第一次绘制开始时算起；停画期间不交，窗在下一次绘制时才结。 */
export function createPaintMeter(
  report: (stats: PaintStats) => void,
  windowMs = METER_WINDOW_MS,
): PaintMeter {
  let windowStart: number | null = null;
  let paints = 0;
  let totalMs = 0;
  let maxMs = 0;
  return {
    record(startedAt, endedAt) {
      windowStart ??= startedAt;
      const duration = Math.max(0, endedAt - startedAt);
      paints += 1;
      totalMs += duration;
      maxMs = Math.max(maxMs, duration);
      const spanMs = endedAt - windowStart;
      if (spanMs < windowMs) return;
      report({ paints, totalMs, maxMs, spanMs });
      windowStart = endedAt;
      paints = 0;
      totalMs = 0;
      maxMs = 0;
    },
  };
}

/** 从 Worker 发回来的统计先核对：四个字段都得是有限数。 */
export function isPaintStats(value: unknown): value is PaintStats {
  if (typeof value !== 'object' || value === null) return false;
  return ['paints', 'totalMs', 'maxMs', 'spanMs'].every((key) =>
    Number.isFinite(Reflect.get(value, key)),
  );
}
