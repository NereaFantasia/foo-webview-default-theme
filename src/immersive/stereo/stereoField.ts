import { MISSING } from '../paper/paperScale.ts';

/**
 * 立体声声场的数学。输入是同一段短窗里逐点配对的左右两路样本（有符号，−1…1），两路长度不等时按短的算。
 * 三个读数只用三组能量和——ΣL²、ΣR²、ΣL·R——来算：几段短窗的和可以按时间加权累加，
 * 读数因此能跨窗积分，不必留着原始样本。
 */
export interface StereoSums {
  /** ΣL² */
  ll: number;
  /** ΣR² */
  rr: number;
  /** ΣL·R */
  lr: number;
}

/** 声场图上的一点：x 向右、y 向上；框的半边长对应 1，满幅同相信号在竖轴上到 √2。 */
export interface StereoPoint {
  x: number;
  y: number;
}

/** 三个读数；无定义时为 `null`，显示成 `—`。 */
export interface StereoReadings {
  correlation: number | null;
  width: number | null;
  /** 右路比左路响多少 dB；只有一侧有声时是 ±Infinity。 */
  balance: number | null;
}

export const EMPTY_READINGS: StereoReadings = { correlation: null, width: null, balance: null };

/**
 * 读数积分的时间常数（毫秒）。单个窗算出的相关与宽度逐窗跳得厉害，每秒刷新几十次时数字和游标都看不清；
 * 按这个常数把各窗的能量和做指数加权再算。
 */
export const READOUT_TAU_MS = 300;

const pairCount = (left: readonly number[], right: readonly number[]): number =>
  Math.min(left.length, right.length);

/** (L, R) 转 45°：`x = (L − R) / √2`、`y = (L + R) / √2`。单声道落在竖轴上，只有左声道时落在 +45° 线上。 */
export function rotate45(left: readonly number[], right: readonly number[]): StereoPoint[] {
  return Array.from({ length: pairCount(left, right) }, (_, index) => {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    return { x: (l - r) * Math.SQRT1_2, y: (l + r) * Math.SQRT1_2 };
  });
}

export function sumsOf(left: readonly number[], right: readonly number[]): StereoSums {
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let index = 0; index < pairCount(left, right); index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    ll += l * l;
    rr += r * r;
    lr += l * r;
  }
  return { ll, rr, lr };
}

/** 两段窗相隔 `elapsedMs` 时，之前的累计留下的比例。 */
export function retainFor(elapsedMs: number): number {
  return elapsedMs > 0 ? Math.exp(-elapsedMs / READOUT_TAU_MS) : 1;
}

/** 之前的累计按 `retain` 衰减后加上新的一窗；还没有累计时就是这一窗。 */
export function accumulate(
  previous: StereoSums | null,
  next: StereoSums,
  retain: number,
): StereoSums {
  if (!previous) return next;
  return {
    ll: previous.ll * retain + next.ll,
    rr: previous.rr * retain + next.rr,
    lr: previous.lr * retain + next.lr,
  };
}

/** 相关 `Σ(L·R) / √(ΣL²·ΣR²)`，−1…+1。任一路没有能量（静音、只有一侧有声）时无定义。 */
export function correlation({ ll, rr, lr }: StereoSums): number | null {
  if (!(ll > 0 && rr > 0)) return null;
  return Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr)));
}

/**
 * 宽度：side / mid 能量比 `Σ(L−R)² / Σ(L+R)²`。单声道是 0，左右不相关（含只有一侧有声）是 1，偏反相时大于 1；
 * mid 没有能量（静音或完全反相）时无定义。
 */
export function width({ ll, rr, lr }: StereoSums): number | null {
  const mid = ll + rr + 2 * lr;
  if (!(mid > 0)) return null;
  return Math.max(0, ll + rr - 2 * lr) / mid;
}

/** 平衡：右路与左路 RMS 之比的 dB，正值是右边响。两路都静音时无定义。 */
export function balanceDb({ ll, rr }: StereoSums): number | null {
  if (!(ll > 0 || rr > 0)) return null;
  return 10 * Math.log10(rr / ll);
}

export function readingsOf(sums: StereoSums): StereoReadings {
  return { correlation: correlation(sums), width: width(sums), balance: balanceDb(sums) };
}

/** 两位小数，正值带 `+`；舍入成 0 的不带符号。 */
export function formatCorrelation(value: number | null): string {
  if (value === null) return MISSING;
  const text = value.toFixed(2);
  if (text === '0.00' || text === '-0.00') return '0.00';
  return value > 0 ? `+${text}` : text;
}

/** 按显示出来的两位小数判负，舍入成 0.00 的不算。 */
export function isNegativeCorrelation(value: number | null): boolean {
  return formatCorrelation(value).startsWith('-');
}

export function formatWidth(value: number | null): string {
  return value === null ? MISSING : value.toFixed(2);
}

/** 写偏向的一侧与 dB 数、一位小数：`L 0.3 dB`、`R 1.2 dB`；舍入成 0 写 `0.0 dB`，只有一侧有声写 `∞`。 */
export function formatBalance(value: number | null): string {
  if (value === null) return MISSING;
  const magnitude = Math.abs(value);
  const text = Number.isFinite(magnitude) ? magnitude.toFixed(1) : '∞';
  if (text === '0.0') return '0.0 dB';
  return `${value < 0 ? 'L' : 'R'} ${text} dB`;
}

/** 声场格里显示的三个读数，加相关游标在 −1…+1 刻度上的位置（百分比，−1 在左端；没有读数为 null）。 */
export interface StereoReadouts {
  correlation: string;
  negative: boolean;
  cursor: number | null;
  width: string;
  balance: string;
}

export function stereoReadouts(readings: StereoReadings): StereoReadouts {
  const value = readings.correlation;
  return {
    correlation: formatCorrelation(value),
    negative: isNegativeCorrelation(value),
    cursor: value === null ? null : (value + 1) * 50,
    width: formatWidth(readings.width),
    balance: formatBalance(readings.balance),
  };
}
