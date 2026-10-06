import { expect, test } from 'vitest';
import {
  MIN_CONFIDENCE,
  analyseBeats,
  trackBeats,
} from '../../../../src/immersive/tempo/beatTracker.ts';
import { estimatePeriod } from '../../../../src/immersive/tempo/tempoCorrelation.ts';

/**
 * 逐拍跟踪在合成的起音曲线上测：拍点处是尖峰、其余是小噪声。帧率照 22050 Hz / 256 样本一帧。
 * 噪声用固定种子的伪随机，结果可复现。
 */
const FPS = 22050 / 256;

function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** 按给定的拍点时刻（秒）造起音曲线；`length` 秒长。 */
function onsetAt(times: readonly number[], length: number, seed = 1): Float32Array {
  const random = noise(seed);
  const out = Float32Array.from({ length: Math.ceil(length * FPS) }, () => random() * 0.2);
  for (const time of times) {
    const frame = Math.round(time * FPS);
    if (frame < out.length) out[frame] = 3 + random();
  }
  return out;
}

const steady = (bpm: number, from: number, to: number): number[] => {
  const times: number[] = [];
  for (let time = from; time < to; time += 60 / bpm) times.push(time);
  return times;
};

/** 几层节奏叠在一起：每层是「每隔 `beats` 拍一下、强度 `strength`」，同一帧取最强的。40 秒长。 */
function layered(
  bpm: number,
  layers: readonly (readonly [beats: number, strength: number])[],
  seed: number,
) {
  const random = noise(seed);
  const out = Float32Array.from({ length: Math.ceil(40 * FPS) }, () => random() * 0.2);
  for (const [beats, strength] of layers) {
    for (let time = 0.2; time < 40; time += (60 / bpm) * beats) {
      const frame = Math.round(time * FPS);
      out[frame] = Math.max(out[frame] ?? 0, strength + random() * 0.3);
    }
  }
  return out;
}

test('稳定速度：每一拍都落在起音上（误差不超过一帧）', () => {
  const times = steady(128, 0.2, 40);
  const onset = onsetAt(times, 40);
  const period = estimatePeriod(onset, FPS);
  if (!period) throw new Error('估不出拍长');
  const beats = trackBeats(onset, period);
  expect(beats.length).toBe(times.length);
  beats.forEach((frame, index) => {
    expect(Math.abs(frame - (times[index] ?? 0) * FPS), `${index}: ${frame}`).toBeLessThanOrEqual(
      1,
    );
  });
});

test('速度漂移（116 → 124 BPM）：拍点仍逐拍跟着起音走', () => {
  const times: number[] = [];
  for (let time = 0.5; time < 60;) {
    times.push(time);
    time += 60 / (116 + (8 * time) / 60);
  }
  const onset = onsetAt(times, 60, 7);
  const period = estimatePeriod(onset, FPS);
  if (!period) throw new Error('估不出拍长');
  const beats = trackBeats(onset, period);
  expect(
    Math.abs(beats.length - times.length),
    `${beats.length} vs ${times.length}`,
  ).toBeLessThanOrEqual(1);
  for (const frame of beats) {
    const nearest = Math.min(...times.map((time) => Math.abs(time * FPS - frame)));
    expect(nearest, `${frame}: ${nearest}`).toBeLessThanOrEqual(2);
  }
});

test('头尾的静音与引子里不铺拍', () => {
  const times = steady(100, 8, 38);
  const beats = trackBeats(onsetAt(times, 46, 3), FPS * 0.6);
  expect(beats[0] ?? 0, String(beats[0])).toBeGreaterThanOrEqual(8 * FPS - 1);
  expect(beats[beats.length - 1] ?? 0, String(beats[beats.length - 1])).toBeLessThanOrEqual(
    38 * FPS + 1,
  );
});

// 附点节奏型比底鼓还响时，自相关最强的周期是它的；挑层级要回到底鼓与十六分踩镲所在的那一层。
test('附点节奏：每 0.75 拍的强琶音不把 128 BPM 带成 170，每 1.5 拍的不带成 85', () => {
  const quarter = analyseBeats(
    layered(
      128,
      [
        [0.25, 0.8],
        [1, 2.4],
        [0.75, 3],
      ],
      3,
    ),
    FPS,
  );
  expect(quarter && Math.abs(quarter.bpm - 128) < 1.5, String(quarter?.bpm)).toBe(true);
  const half = analyseBeats(
    layered(
      127,
      [
        [0.5, 0.8],
        [1, 2.4],
        [1.5, 3],
      ],
      5,
    ),
    FPS,
  );
  expect(half && Math.abs(half.bpm - 127) < 1.5, String(half?.bpm)).toBe(true);
});

test('半速：每拍一样强的 176 BPM 底鼓，先验估成慢一半后翻回 176', () => {
  const onset = layered(
    176,
    [
      [0.5, 0.6],
      [1, 3],
    ],
    7,
  );
  const estimate = estimatePeriod(onset, FPS);
  expect(estimate && (FPS * 60) / estimate < 130, String(estimate)).toBe(true);
  const track = analyseBeats(onset, FPS);
  expect(track && Math.abs(track.bpm - 176) < 2, String(track?.bpm)).toBe(true);
});

test('不该换层级的：纯节拍器 128、三连音律动的 96 BPM 都保持原样', () => {
  const clicks = analyseBeats(layered(128, [[1, 3]], 1), FPS);
  expect(clicks && Math.abs(clicks.bpm - 128) < 1.5, String(clicks?.bpm)).toBe(true);
  const triplet = analyseBeats(
    layered(
      96,
      [
        [1 / 3, 0.8],
        [1, 3],
      ],
      9,
    ),
    FPS,
  );
  expect(triplet && Math.abs(triplet.bpm - 96) < 1.5, String(triplet?.bpm)).toBe(true);
});

// 每 2/3 拍一下的三对二律动：4/3 倍候选（70.5 BPM）的十六分点正落在这些音上，网格贴合度与拍点强度都过门槛，
// 只有层级树分约为估值的六成。没有这道否决就会换过去，两拍正中也有音，再翻倍成 141。
test('层级树否决：94 BPM 的三对二律动保持 94，不换到 4/3 倍再翻成 141', () => {
  const track = analyseBeats(
    layered(
      94,
      [
        [1, 2.4],
        [2 / 3, 1.8],
      ],
      5,
    ),
    FPS,
  );
  expect(track && Math.abs(track.bpm - 94) < 1.5, String(track?.bpm)).toBe(true);
});

// 只有噪声时显著度约为 1（拍点挑在局部高点上，会略高一点），低于门槛；节拍分明时远高于门槛。
test('汇总：BPM 取平均拍距，节拍分明时显著度远高于门槛，只有噪声时低于门槛', () => {
  const track = analyseBeats(onsetAt(steady(128, 0.2, 40), 40), FPS);
  if (!track) throw new Error('跟不出拍');
  expect(Math.abs(track.bpm - 128), String(track.bpm)).toBeLessThan(1.5);
  expect(track.confidence, String(track.confidence)).toBeGreaterThan(3);
  expect(track.beats.length > 80).toBe(true);
  const random = noise(11);
  const flat = Float32Array.from({ length: Math.ceil(40 * FPS) }, () => random());
  const none = analyseBeats(flat, FPS);
  expect(none === null || none.confidence < MIN_CONFIDENCE, String(none?.confidence)).toBe(true);
});
