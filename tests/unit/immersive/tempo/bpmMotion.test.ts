import { expect, test } from 'vitest';
import { MIN_CONFIDENCE, type BeatTrack } from '../../../../src/immersive/tempo/beatTracker.ts';
import {
  BEAT_DOTS,
  beatCount,
  beatDot,
  bpmAt,
  edgeBump,
  pendulumPosition,
  tempoOf,
  type BeatTimeline,
} from '../../../../src/immersive/tempo/bpmMotion.ts';

/** BPM 格的摆锤与 Beat 点：按时间线数拍（逐拍拍点或标签等距），两拍一个来回，拍点落在两端。 */
const near = (actual: number | null, expected: number) =>
  expect(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`).toBe(
    true,
  );

const uniform = (bpm: number, offset = 0): BeatTimeline => ({ kind: 'uniform', bpm, offset });
const tracked = (beats: number[]): BeatTimeline => ({ kind: 'tracked', beats });

test('等距时间线：120 BPM 每秒两拍，偏移从第一拍起数；BPM 不可用或时刻不是有限数时没有拍数', () => {
  near(beatCount(uniform(120), 3), 6);
  near(beatCount(uniform(120, 0.5), 3), 5);
  expect(beatCount(uniform(0), 3)).toBe(null);
  expect(beatCount(uniform(120), Number.NaN)).toBe(null);
  expect(beatCount(null, 3)).toBe(null);
});

test('逐拍时间线：拍点上是整数，两拍之间按这一拍的实际拍距插值，拍距不等也每拍落在整数上', () => {
  const timeline = tracked([1, 1.5, 2.1, 2.6, 3.2]);
  near(beatCount(timeline, 1.5), 1);
  near(beatCount(timeline, 2.1), 2);
  near(beatCount(timeline, 1.8), 1.5);
  near(beatCount(timeline, 2.35), 2.5);
  // 引子与结尾按平均拍距（0.55 s）往外数。
  near(beatCount(timeline, 0.45), -1);
  near(beatCount(timeline, 3.75), 5);
  expect(beatCount(tracked([1]), 2)).toBe(null);
});

test('摆锤：拍点落在两端，两拍一个来回，之间线性往返；没有拍数停在正中', () => {
  near(pendulumPosition(0), 0);
  near(pendulumPosition(1), 1);
  near(pendulumPosition(2), 0);
  near(pendulumPosition(0.25), 0.25);
  near(pendulumPosition(1.25), 0.75);
  near(pendulumPosition(-0.25), 0.25);
  near(pendulumPosition(beatCount(uniform(140), 2)), 2 / 3);
  expect(pendulumPosition(null)).toBe(0.5);
});

test('edgeBump：行程中段为 0，进到两端 8% 以内升到 1', () => {
  expect(edgeBump(0.5)).toBe(0);
  expect(edgeBump(0.08)).toBe(0);
  near(edgeBump(0.04), 0.5);
  expect(edgeBump(0)).toBe(1);
  expect(edgeBump(1)).toBe(1);
  near(edgeBump(0.98), 0.75);
});

test('Beat 点：逐拍轮换四个点、第五拍回到第一个，负拍数折回；没有拍数为 −1', () => {
  expect(BEAT_DOTS).toBe(4);
  expect([0, 0.99, 1, 2.5, 3.2, 4].map((count) => beatDot(count))).toStrictEqual([
    0, 0, 1, 2, 3, 0,
  ]);
  expect(beatDot(-0.5)).toBe(3);
  expect(beatDot(null)).toBe(-1);
});

test('选时间线：跟出来且显著度够的优先；显著度不够或跟不出时用标签；都没有给 null', () => {
  const track = (confidence: number): BeatTrack => ({
    beats: Float64Array.of(1, 1.5, 2),
    bpm: 120,
    confidence,
    segments: [{ start: 0, bpm: 120 }],
  });
  expect(tempoOf(track(MIN_CONFIDENCE), '90')?.timeline.kind).toStrictEqual('tracked');
  expect(tempoOf(track(MIN_CONFIDENCE), '90')?.segments).toStrictEqual([{ start: 0, bpm: 120 }]);
  const fallback = tempoOf(track(MIN_CONFIDENCE - 0.01), '90');
  expect(fallback).toStrictEqual({
    segments: [{ start: 0, bpm: 90 }],
    timeline: { kind: 'uniform', bpm: 90, offset: 0 },
  });
  expect(tempoOf(null, '128.00')?.segments).toStrictEqual([{ start: 0, bpm: 128 }]);
  expect(tempoOf(null, undefined)).toBe(null);
  expect(tempoOf(null, 'abc')).toBe(null);
});

test('格里的数：变速曲按播放位置写所在那段的，第一段之前算第一段', () => {
  const tempo = {
    segments: [
      { start: 0, bpm: 139 },
      { start: 68, bpm: 175 },
    ],
    timeline: tracked([1, 2]),
  };
  expect(bpmAt(tempo, -1)).toBe(139);
  expect(bpmAt(tempo, 67.9)).toBe(139);
  expect(bpmAt(tempo, 68)).toBe(175);
  expect(bpmAt(tempo, 300)).toBe(175);
});
