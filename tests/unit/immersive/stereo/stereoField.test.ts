import { describe, expect, test } from 'vitest';
import {
  READOUT_TAU_MS,
  accumulate,
  balanceDb,
  correlation,
  formatBalance,
  formatCorrelation,
  formatWidth,
  isNegativeCorrelation,
  readingsOf,
  retainFor,
  rotate45,
  stereoReadouts,
  sumsOf,
  width,
} from '../../../../src/immersive/stereo/stereoField.ts';

const sine = (count: number, amplitude = 0.8, phase = 0) =>
  Array.from({ length: count }, (_, index) => amplitude * Math.sin((index / 32) * Math.PI + phase));

/** 带种子的伪随机（线性同余），−1…1；两路各取一个种子就互不相关。 */
function noise(count: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * 2 - 1;
  });
}

const near = (actual: number | null, expected: number, epsilon = 1e-9) => {
  expect(actual, `${actual} ≉ ${expected}`).not.toBe(null);
  expect(
    Math.abs((actual ?? Number.NaN) - expected),
    `${actual} ≉ ${expected}`,
  ).toBeLessThanOrEqual(epsilon);
};

describe('stereoField', () => {
  test('stereoReadouts：三个读数的写法与相关游标的位置（−1 在 0%、+1 在 100%），没有读数时游标为 null', () => {
    expect(stereoReadouts({ correlation: -0.5, width: 0.25, balance: 1.2 })).toStrictEqual({
      correlation: '-0.50',
      negative: true,
      cursor: 25,
      width: '0.25',
      balance: 'R 1.2 dB',
    });
    expect(stereoReadouts({ correlation: null, width: null, balance: null })).toStrictEqual({
      correlation: '—',
      negative: false,
      cursor: null,
      width: '—',
      balance: '—',
    });
  });

  test('同相（L = R）：相关 +1、宽度 0、平衡 0，点全在竖轴上', () => {
    const left = sine(256);
    const sums = sumsOf(left, left);
    near(correlation(sums), 1);
    near(width(sums), 0);
    near(balanceDb(sums), 0);
    for (const point of rotate45(left, left)) near(point.x, 0);
  });

  test('反相（R = −L）：相关 −1，mid 没有能量时宽度无定义', () => {
    const left = sine(256);
    const sums = sumsOf(
      left,
      left.map((value) => -value),
    );
    near(correlation(sums), -1);
    expect(width(sums)).toBe(null);
    near(balanceDb(sums), 0);
  });

  test('只有左声道：平衡偏 L 到 ∞、宽度 1、相关无定义，点云落在 +45° 线上', () => {
    const left = sine(256);
    const right = left.map(() => 0);
    const sums = sumsOf(left, right);
    expect(balanceDb(sums)).toBe(Number.NEGATIVE_INFINITY);
    expect(formatBalance(balanceDb(sums))).toBe('L ∞ dB');
    near(width(sums), 1);
    expect(correlation(sums)).toBe(null);
    for (const [index, point] of rotate45(left, right).entries()) {
      near(point.x, point.y);
      expect(Math.sign(point.x)).toBe(Math.sign(left[index] ?? 0));
    }
  });

  test('互不相关的两路：相关近 0、宽度近 1', () => {
    const sums = sumsOf(noise(4096, 1), noise(4096, 2));
    const value = correlation(sums);
    expect(value !== null && Math.abs(value) < 0.05, `correlation ${value}`).toBe(true);
    const spread = width(sums);
    expect(spread !== null && Math.abs(spread - 1) < 0.1, `width ${spread}`).toBe(true);
  });

  test('右路是左路的一半：相关 +1、宽度 1/9、平衡 L 6.0 dB', () => {
    const left = sine(256);
    const readings = readingsOf(
      sumsOf(
        left,
        left.map((value) => value / 2),
      ),
    );
    near(readings.correlation, 1);
    near(readings.width, 1 / 9);
    near(readings.balance, 20 * Math.log10(0.5));
    expect(formatBalance(readings.balance)).toBe('L 6.0 dB');
  });

  test('两路都静音：三个读数都无定义；两路长度不等按短的算', () => {
    expect(readingsOf(sumsOf([0, 0, 0], [0, 0, 0]))).toStrictEqual({
      correlation: null,
      width: null,
      balance: null,
    });
    expect(sumsOf([1, 1, 1], [1])).toStrictEqual({ ll: 1, rr: 1, lr: 1 });
    expect(rotate45([1, 1, 1], [1]).length).toBe(1);
  });

  test('rotate45 的四个象限', () => {
    const [up, right, down, left] = rotate45([1, 1, -1, -1], [1, -1, -1, 1]);
    near(up?.x ?? Number.NaN, 0);
    near(up?.y ?? Number.NaN, Math.SQRT2);
    near(right?.x ?? Number.NaN, Math.SQRT2);
    near(right?.y ?? Number.NaN, 0);
    near(down?.x ?? Number.NaN, 0);
    near(down?.y ?? Number.NaN, -Math.SQRT2);
    near(left?.x ?? Number.NaN, -Math.SQRT2);
    near(left?.y ?? Number.NaN, 0);
  });

  test('累加：之前的和按时间常数衰减，一个时间常数后留 1/e；首窗原样', () => {
    near(retainFor(READOUT_TAU_MS), Math.exp(-1));
    expect(retainFor(0)).toBe(1);
    const first = { ll: 4, rr: 1, lr: 2 };
    expect(accumulate(null, first, 0.5)).toBe(first);
    expect(accumulate(first, { ll: 1, rr: 1, lr: 0 }, 0.5)).toStrictEqual({
      ll: 3,
      rr: 1.5,
      lr: 1,
    });
  });

  test('读数的写法：相关两位小数带号、舍入成 0 不带号；宽度两位小数；平衡写偏向一侧', () => {
    expect(formatCorrelation(null)).toBe('—');
    expect(formatCorrelation(1)).toBe('+1.00');
    expect(formatCorrelation(-0.123)).toBe('-0.12');
    expect(formatCorrelation(-0.004)).toBe('0.00');
    expect(isNegativeCorrelation(-0.123)).toBe(true);
    expect(isNegativeCorrelation(-0.004)).toBe(false);
    expect(isNegativeCorrelation(null)).toBe(false);
    expect(formatWidth(null)).toBe('—');
    expect(formatWidth(1 / 9)).toBe('0.11');
    expect(formatBalance(null)).toBe('—');
    expect(formatBalance(-0.3)).toBe('L 0.3 dB');
    expect(formatBalance(1.24)).toBe('R 1.2 dB');
    expect(formatBalance(0.04)).toBe('0.0 dB');
    expect(formatBalance(-0.04)).toBe('0.0 dB');
    expect(formatBalance(Number.POSITIVE_INFINITY)).toBe('R ∞ dB');
  });
});
