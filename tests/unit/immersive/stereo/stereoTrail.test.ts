import { describe, expect, test } from 'vitest';
import type { StereoPoint } from '../../../../src/immersive/stereo/stereoField.ts';
import {
  BEAM_FULL_LENGTH,
  REVEAL_LAG_MS,
  TRAIL_HALF_LIFE_MS,
  TRAIL_LEVELS,
  TRAIL_MAX_AGE_MS,
  arrivedWindow,
  beamAlpha,
  levelAlpha,
  levelOf,
  pruneTrail,
  traceTrail,
  windowAlpha,
  type TrailSink,
  type TrailWindow,
} from '../../../../src/immersive/stereo/stereoTrail.ts';

type Call = [kind: 'move' | 'line', level: number, x: number, y: number];

function record(): { sink: TrailSink; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    sink: {
      moveTo: (level, x, y) => calls.push(['move', level, x, y]),
      lineTo: (level, x, y) => calls.push(['line', level, x, y]),
    },
  };
}

/** 框的半边长 48 px 下，从圆心沿 x 轴每步走 `step` 像素的一串点。 */
const along = (steps: number[]): StereoPoint[] => {
  let x = 0;
  return [{ x: 0, y: 0 }, ...steps.map((step) => ({ x: (x += step) / 48, y: 0 }))];
};
/** 一窗每点 1 ms：第 j 个点在 `at + j` 放出。 */
const windowOf = (points: StereoPoint[], at: number): TrailWindow => ({
  points,
  at,
  span: points.length,
});
/** 窗长短到可以忽略：整窗在 `now` 已放完，各点的年龄都约为 0。 */
const instant = (points: StereoPoint[], now: number): TrailWindow => ({
  points,
  at: now - 1e-6,
  span: 1e-6,
});
const shape = (calls: Call[]) => calls.map(([kind, level, x]) => [kind, level, x]);
/** 各段线终点的 x（画布像素），不管分档。 */
const lineEnds = (calls: Call[]) => calls.filter(([kind]) => kind === 'line').map(([, , x]) => x);
/** 从 `from` 到 `to` 的整数。 */
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('stereoTrail', () => {
  test('亮度按放出之后的时长减半，没到或刚到的是 1', () => {
    expect(windowAlpha(0)).toBe(1);
    expect(windowAlpha(-5)).toBe(1);
    expect(Math.abs(windowAlpha(TRAIL_HALF_LIFE_MS) - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(windowAlpha(2 * TRAIL_HALF_LIFE_MS) - 0.25)).toBeLessThan(1e-12);
  });

  test('线段亮度：满亮度长度以内是 1，更长按长度反比', () => {
    expect(beamAlpha(0)).toBe(1);
    expect(beamAlpha(BEAM_FULL_LENGTH)).toBe(1);
    expect(beamAlpha(BEAM_FULL_LENGTH * 4)).toBe(0.25);
  });

  test('分档取最近的一档，档内透明度是 2^(−k/2)；比最淡一档还淡的不画', () => {
    expect(levelOf(1)).toBe(0);
    expect(levelOf(0.5)).toBe(2);
    expect(levelOf(levelAlpha(TRAIL_LEVELS - 1))).toBe(TRAIL_LEVELS - 1);
    expect(levelOf(levelAlpha(TRAIL_LEVELS))).toBe(null);
    expect(levelOf(0)).toBe(null);
    expect(levelOf(Number.NaN)).toBe(null);
    expect(levelAlpha(2)).toBe(0.5);
    // 正好在最大年龄上落进最淡一档的下沿，再老就不画。
    expect(levelOf(windowAlpha(TRAIL_MAX_AGE_MS))).toBe(TRAIL_LEVELS - 1);
    expect(levelOf(windowAlpha(TRAIL_MAX_AGE_MS + 1))).toBe(null);
  });

  test('逐帧放出：只画已放出的点；新窗接手，旧窗其后的部分丢掉', () => {
    const points = along([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const { sink, calls } = record();
    traceTrail([windowOf(points, 0)], 4.5, 48, sink);
    expect(shape(calls)).toStrictEqual([
      ['move', 0, 48],
      ['line', 0, 49],
      ['line', 0, 50],
      ['line', 0, 51],
      ['line', 0, 52],
    ]);

    const handover = record();
    // 第二窗在 3 ms 到：第一窗只放到第 3 个点，之后放第二窗，到 5 ms 放出两段。
    traceTrail([windowOf(points, 0), windowOf(points, 3)], 5, 48, handover.sink);
    expect(shape(handover.calls)).toStrictEqual([
      ['move', 0, 48],
      ['line', 0, 49],
      ['line', 0, 50],
      ['line', 0, 51],
      ['move', 0, 48],
      ['line', 0, 49],
      ['line', 0, 50],
    ]);
  });

  test('到手的一窗截至到手时刻：每个点晚 REVEAL_LAG_MS 放出，下一窗从它往回够到的那一刻接手', () => {
    // 50 个点、窗长 50 ms、到手于 100 ms：第 j 个点在 50 + j 播到、70 + j 放出。
    const points = along(Array.from({ length: 49 }, () => 1));
    const first = arrivedWindow(points, 100, 50);
    expect(REVEAL_LAG_MS).toBe(20);
    expect(first.at).toBe(70);

    const arrived = record();
    traceTrail([first], 100, 48, arrived.sink);
    // 到手那一刻已放出播到 80 ms 为止的 30 段，余下的在之后 20 ms 里逐帧放完。
    expect(lineEnds(arrived.calls)).toStrictEqual(range(49, 78));
    const finished = record();
    traceTrail([first], 120, 48, finished.sink);
    expect(lineEnds(finished.calls)).toStrictEqual(range(49, 97));

    // 下一窗 117 ms 到手、往回够到 67 ms：头一窗只放到播到 67 ms 的第 17 个点，后面接新窗的第 0 个点。
    const handover = record();
    traceTrail([first, arrivedWindow(points, 117, 50)], 117, 48, handover.sink);
    expect(lineEnds(handover.calls)).toStrictEqual([...range(49, 65), ...range(49, 78)]);
  });

  test('放出的点越旧越淡：放出一个半衰期后的那段落在第 2 档', () => {
    const { sink, calls } = record();
    const points = along([1]);
    traceTrail([windowOf(points, 0)], 1 + TRAIL_HALF_LIFE_MS, 48, sink);
    expect(shape(calls)).toStrictEqual([
      ['move', 2, 48],
      ['line', 2, 49],
    ]);
  });

  test('长线段调暗落到更淡的档，换档处另起一笔，回到原档也另起；坐标 y 向下', () => {
    const { sink, calls } = record();
    // 1 px 满亮度、8 px 是满亮度长度的 4 倍（透明度 1/4，第 4 档）、再 1 px 回到第 0 档。
    traceTrail([instant(along([1, 8, 1]), 100)], 100, 48, sink);
    expect(shape(calls)).toStrictEqual([
      ['move', 0, 48],
      ['line', 0, 49],
      ['move', 4, 49],
      ['line', 4, 57],
      ['move', 0, 57],
      ['line', 0, 58],
    ]);
    const up = record();
    traceTrail(
      [
        instant(
          [
            { x: 0, y: 0 },
            { x: 0, y: 0.02 },
          ],
          0,
        ),
      ],
      0,
      48,
      up.sink,
    );
    expect(Math.abs((up.calls[1]?.[3] ?? 0) - 47.04)).toBeLessThan(1e-9);
  });

  test('淡到最淡一档以下的线段不画、也不跟下一段连笔', () => {
    const { sink, calls } = record();
    // 第二段 200 px：透明度 0.01，低于最淡一档。
    traceTrail([instant(along([1, 200, 1]), 0)], 0, 48, sink);
    expect(shape(calls)).toStrictEqual([
      ['move', 0, 48],
      ['line', 0, 49],
      ['move', 0, 249],
      ['line', 0, 250],
    ]);
  });

  test('剪队：放过的部分全部淡到看不见的窗丢掉；窗放到下一窗接手为止', () => {
    const windows: TrailWindow[] = [
      { points: along([1]), at: 0, span: 50 },
      { points: along([1]), at: 100, span: 50 },
    ];
    // 第一窗放到 50 ms 为止；150 ms 过后又淡完一个最大年龄。
    expect(pruneTrail(windows, 50 + TRAIL_MAX_AGE_MS + 1).map((entry) => entry.at)).toStrictEqual([
      100,
    ]);
    expect(pruneTrail(windows, 0).length).toBe(2);
    // 第二窗 20 ms 就接手：第一窗放到 20 ms 为止，更早淡完。
    const handover: TrailWindow[] = [
      { points: along([1]), at: 0, span: 50 },
      { points: along([1]), at: 20, span: 50 },
    ];
    expect(pruneTrail(handover, 21 + TRAIL_MAX_AGE_MS).length).toBe(1);
  });
});
