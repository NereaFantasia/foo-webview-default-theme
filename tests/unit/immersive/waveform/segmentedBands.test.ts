import { expect, test } from 'vitest';
import {
  analyseSegments,
  planSegments,
  windowRmsAt,
  type PcmPiece,
} from '../../../../src/immersive/waveform/segmentedBands.ts';
import type { BandSignals } from '../../../../src/immersive/waveform/waveformBands.ts';

/**
 * 整轨分频的分段：段怎么切、样本怎么按时间落到窗里、预滚不计入窗、中途作废。分频本身（Web Audio）注入替身：
 * 每个假 AudioBuffer 自带四条链的输出。
 */
const RATE = 10;

/** 假 AudioBuffer：`samples` 同时当四条链的输出，`weighted` 取两倍以区分。 */
function pieceOf(samples: number[], start: number): PcmPiece & { signals: BandSignals } {
  const low = Float32Array.from(samples);
  const signals = { low, mid: low, high: low, weighted: low.map((value) => value * 2) };
  const audio = { sampleRate: RATE, length: samples.length } as AudioBuffer;
  return { audio, start, signals };
}

const renderOf = (pieces: Map<AudioBuffer, BandSignals>) => async (audio: AudioBuffer) => {
  const signals = pieces.get(audio);
  if (!signals) throw new Error('render 收到的不是来源给的那块');
  return signals;
};

test('按段切：段数按段长上限定、窗平均分，首尾相接盖满整首，段首往前多要预滚、不早于 0', () => {
  const duration = 284;
  const windows = 1024;
  const segments = planSegments(duration, windows, 120, 0.5);
  const windowSeconds = duration / windows;
  // 上限每段 432 个窗（约 119.8 s）要三段，平均分成 342 / 342 / 340，而不是 432 / 432 / 160。
  expect(segments.map((segment) => [segment.firstWindow, segment.windowCount])).toStrictEqual([
    [0, 342],
    [342, 342],
    [684, 340],
  ]);
  expect(segments[0]?.start).toBe(0);
  expect(Math.abs((segments[1]?.start ?? 0) - (342 * windowSeconds - 0.5))).toBeLessThan(1e-9);
  expect(Math.abs((segments[2]?.end ?? 0) - duration)).toBeLessThan(1e-9);
  for (const segment of segments) {
    expect(segment.windowCount * windowSeconds).toBeLessThanOrEqual(120 + 1e-9);
  }
});

test('短曲一段；段长比一个窗还短时每段一个窗；时长或窗数不可用时不切', () => {
  expect(planSegments(60, 4, 120, 0.5)).toStrictEqual([
    { firstWindow: 0, windowCount: 4, start: 0, end: 60 },
  ]);
  expect(planSegments(10, 4, 1, 0).length).toBe(4);
  // 360 s 按 120 s 上限：每段最多 341 个窗要四段，平均分成 256 × 4，不留一个窗的尾巴。
  expect(planSegments(360, 1024, 120, 0.5).map((segment) => segment.windowCount)).toStrictEqual([
    256, 256, 256, 256,
  ]);
  for (const duration of [0, -1, Number.NaN]) expect(planSegments(duration, 4)).toStrictEqual([]);
  expect(planSegments(60, 0)).toStrictEqual([]);
});

test('按时间落窗：样本从 sampleStart 起；没盖到的窗写 0，只盖到一部分的按有的算', () => {
  const out = new Float32Array(5).fill(-1);
  // 样本从 1.0 s 起、共 1.2 s（12 个）：窗 2（1.0–1.5 s）与窗 3 盖满，窗 4 只盖到前 0.2 s。
  const samples = [3, -3, 3, -3, 3, 4, -4, 4, -4, 4, 1, -1];
  windowRmsAt(samples, RATE, 1, 0.5, 1, 4, out);
  expect(out[0], '不在请求范围里的窗不动').toBe(-1);
  expect(Array.from(out.subarray(1))).toStrictEqual([0, 3, 4, 1]);
});

test('整首按段取、按段分频：预滚那一截不计入窗，窗落在各自的位置', async () => {
  const ranges: { start: number; end: number }[] = [];
  const pieces = new Map<AudioBuffer, BandSignals>();
  // 4 s、4 个窗、每段 2 s、预滚 0.5 s：两段 [0, 2] 与 [1.5, 4]。预滚那 0.5 s 填 9，漏进窗里就会变大。
  const result = await analyseSegments(
    async (range) => {
      ranges.push(range);
      const frames = Math.round((range.end - range.start) * RATE);
      const preroll = range.start > 0 ? 5 : 0;
      const level = ranges.length;
      const piece = pieceOf(
        Array.from({ length: frames }, (_, index) => (index < preroll ? 9 : level)),
        range.start,
      );
      pieces.set(piece.audio, piece.signals);
      return piece;
    },
    4,
    4,
    { segmentSeconds: 2, prerollSeconds: 0.5, render: renderOf(pieces) },
  );
  expect(ranges).toStrictEqual([
    { start: 0, end: 2 },
    { start: 1.5, end: 4 },
  ]);
  if (!result) throw new Error('没有分频结果');
  expect(Array.from(result.low)).toStrictEqual([1, 1, 2, 2]);
  expect(Array.from(result.weighted)).toStrictEqual([2, 2, 4, 4]);
});

test('任何一段取不了、或中途不再需要：给 null，后面的段不再取', async () => {
  let calls = 0;
  const failing = await analyseSegments(
    async () => {
      calls += 1;
      return null;
    },
    4,
    4,
    { segmentSeconds: 1 },
  );
  expect(failing).toBe(null);
  expect(calls).toBe(1);

  const pieces = new Map<AudioBuffer, BandSignals>();
  let current = true;
  let fetched = 0;
  const stale = await analyseSegments(
    async (range) => {
      fetched += 1;
      const piece = pieceOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], range.start);
      pieces.set(piece.audio, piece.signals);
      return piece;
    },
    4,
    4,
    {
      segmentSeconds: 1,
      prerollSeconds: 0,
      render: async (audio) => {
        current = false;
        return renderOf(pieces)(audio);
      },
      isCurrent: () => current,
    },
  );
  expect(stale).toBe(null);
  expect(fetched).toBe(1);
});

test('时长不可用：不取、给 null', async () => {
  let calls = 0;
  const result = await analyseSegments(
    async () => {
      calls += 1;
      return null;
    },
    0,
    1024,
  );
  expect(result).toBe(null);
  expect(calls).toBe(0);
});
