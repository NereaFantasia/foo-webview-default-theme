import { expect, test } from 'vitest';
import {
  COLUMN_PITCH,
  columnCount,
  columnLevels,
  playedColumnCount,
  secondsAt,
} from '../../../../src/immersive/waveform/waveformColumns.ts';

/** 图纸整轨波形的数值部分：列数、列高重采样、横坐标换秒数。 */
test('列数：600 宽 200 列（2 px 条 + 1 px 空，末列后不留空）；非正宽 0 列', () => {
  expect(COLUMN_PITCH).toBe(3);
  expect(columnCount(600)).toBe(200);
  expect(columnCount(599)).toBe(200);
  expect(columnCount(1)).toBe(0);
  expect(columnCount(0)).toBe(0);
});

test('列高：一列取所覆盖点的最大值，短促的响段不被均掉；夹到 1；空点全 0', () => {
  const points = Array.from({ length: 1024 }, (_, index) => (index === 515 ? 0.9 : 0.1));
  const levels = columnLevels(points, 200);
  expect(levels.length).toBe(200);
  // 第 100 列覆盖点 512…516（floor(100 × 1024 / 200) 到 floor(101 × 1024 / 200) 之前）。
  expect(Math.abs((levels[100] ?? 0) - 0.9)).toBeLessThan(1e-6);
  expect(Math.abs((levels[99] ?? 0) - 0.1)).toBeLessThan(1e-6);
  expect(columnLevels([1.5], 1)[0]).toBe(1);
  expect(columnLevels([], 5).every((value) => value === 0)).toBe(true);
});

test('列高：点比列少时每列至少取一个点，按位置对应', () => {
  const levels = columnLevels([0.2, 0.8], 4);
  expect([...levels].map((value) => Math.round(value * 10))).toStrictEqual([2, 2, 8, 8]);
});

test('横坐标换秒数：按比例，出了两端夹到 0 与时长；宽或时长不合法给 0', () => {
  expect(secondsAt(300, 600, 284)).toBe(142);
  expect(secondsAt(-20, 600, 284)).toBe(0);
  expect(secondsAt(700, 600, 284)).toBe(284);
  expect(secondsAt(300, 0, 284)).toBe(0);
  expect(secondsAt(300, 600, 0)).toBe(0);
});

test('已播列数：列的中线不在播放头右边就算已播；播放头在最左时一列都不算', () => {
  expect(playedColumnCount(0)).toBe(0);
  expect(playedColumnCount(0.99)).toBe(0);
  expect(playedColumnCount(1)).toBe(1);
  expect(playedColumnCount(COLUMN_PITCH)).toBe(1);
  expect(playedColumnCount(COLUMN_PITCH + 1)).toBe(2);
  expect(playedColumnCount(-5)).toBe(0);
});
