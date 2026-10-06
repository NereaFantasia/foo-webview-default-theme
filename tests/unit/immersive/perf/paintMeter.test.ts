import { describe, expect, test } from 'vitest';
import {
  createPaintMeter,
  isPaintStats,
  type PaintStats,
} from '../../../../src/immersive/perf/paintMeter.ts';

/** 绘制计时：按窗汇总、窗界、停画期间不交，以及 Worker 回报的字段核对。 */
describe('createPaintMeter', () => {
  test('一窗从第一次绘制开始算，跨满窗长的那一次画完才交；下一窗从交出的时刻接着算', () => {
    const reports: PaintStats[] = [];
    const meter = createPaintMeter((stats) => reports.push(stats), 100);
    meter.record(0, 2);
    meter.record(40, 45);
    expect(reports).toStrictEqual([]);
    meter.record(99, 101);
    expect(reports).toStrictEqual([{ paints: 3, totalMs: 9, maxMs: 5, spanMs: 101 }]);

    meter.record(150, 151);
    meter.record(201, 203);
    expect(reports[1]).toStrictEqual({ paints: 2, totalMs: 3, maxMs: 2, spanMs: 102 });
  });

  test('停画期间不交；再画一次时这一窗连同停着的那段一起结，每秒次数随之变低', () => {
    const reports: PaintStats[] = [];
    const meter = createPaintMeter((stats) => reports.push(stats), 100);
    meter.record(0, 1);
    meter.record(1000, 1001);
    expect(reports).toStrictEqual([{ paints: 2, totalMs: 2, maxMs: 1, spanMs: 1001 }]);
  });

  test('时钟倒退时耗时按 0 记', () => {
    const reports: PaintStats[] = [];
    const meter = createPaintMeter((stats) => reports.push(stats), 10);
    meter.record(5, 3);
    meter.record(20, 20);
    expect(reports).toStrictEqual([{ paints: 2, totalMs: 0, maxMs: 0, spanMs: 15 }]);
  });
});

describe('isPaintStats', () => {
  test('Worker 回报的统计四个字段都得是有限数', () => {
    expect(isPaintStats({ paints: 1, totalMs: 2, maxMs: 2, spanMs: 500 })).toBe(true);
    for (const value of [
      null,
      3,
      { paints: 1, totalMs: 2, maxMs: 2 },
      { paints: 1, totalMs: 2, maxMs: Number.NaN, spanMs: 500 },
      { paints: '1', totalMs: 2, maxMs: 2, spanMs: 500 },
    ]) {
      expect(isPaintStats(value), JSON.stringify(value)).toBe(false);
    }
  });
});
