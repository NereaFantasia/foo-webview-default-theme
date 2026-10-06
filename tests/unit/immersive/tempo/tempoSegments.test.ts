import { expect, test } from 'vitest';
import { analyseBeats } from '../../../../src/immersive/tempo/beatTracker.ts';
import { analyseTempo } from '../../../../src/immersive/tempo/tempoSegments.ts';

/**
 * 在合成的鼓点上测变速切段：每层是「每隔 `beats` 拍一下、强度 `strength`」，底下是小噪声。
 * 帧率照 22050 Hz / 256 样本一帧；噪声用固定种子的伪随机，结果可复现。
 */
const FPS = 22050 / 256;
const KIT = [
  [1, 3],
  [0.5, 1.2],
  [0.25, 0.6],
] as const;
const noPause = async (): Promise<void> => {};

function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** `parts` 各段从 `from` 到 `to` 秒按各自的 BPM 打同一套鼓；`length` 秒长。 */
function drums(
  parts: readonly { from: number; to: number; bpm: number }[],
  length: number,
  seed: number,
) {
  const random = noise(seed);
  const out = Float32Array.from({ length: Math.ceil(length * FPS) }, () => random() * 0.2);
  for (const { from, to, bpm } of parts) {
    for (const [beats, strength] of KIT) {
      for (let time = from; time < to; time += (60 / bpm) * beats) {
        const frame = Math.round(time * FPS);
        out[frame] = Math.max(out[frame] ?? 0, strength + random() * 0.3);
      }
    }
  }
  return out;
}

test('变速：前 60 s 120 BPM、之后 150 BPM，切成两段各写各的 BPM，交界处拍距不突变', async () => {
  for (const seed of [1, 2, 3]) {
    const onset = drums(
      [
        { from: 0.2, to: 60, bpm: 120 },
        { from: 60, to: 150, bpm: 150 },
      ],
      150,
      seed,
    );
    const track = await analyseTempo(onset, FPS, { pause: noPause });
    if (!track) throw new Error(`种子 ${seed} 跟不出拍`);
    const [first, second] = track.segments;
    expect(track.segments.length, JSON.stringify(track.segments)).toBe(2);
    expect(
      first && first.start === 0 && Math.abs(first.bpm - 120) < 1.5,
      JSON.stringify(first),
    ).toBe(true);
    if (!(second && Math.abs(second.bpm - 150) < 1.5)) {
      throw new Error(`第二段不是 150 BPM：${JSON.stringify(second)}`);
    }
    // 按窗定的切点落在真实变速点之后一个窗步到一个半窗之间。
    expect(second.start >= 60 && second.start <= 70, String(second.start)).toBe(true);
    for (let index = 2; index < track.beats.length; index += 1) {
      const gap = (track.beats[index] ?? 0) - (track.beats[index - 1] ?? 0);
      const before = (track.beats[index - 1] ?? 0) - (track.beats[index - 2] ?? 0);
      expect(gap > 0.6 * before && gap < 1.6 * before, `${index}: ${before} → ${gap}`).toBe(true);
    }
  }
});

test('不变速：120 BPM 的鼓只有一段，结果与整首跑一遍相同', async () => {
  const onset = drums([{ from: 0.2, to: 150, bpm: 120 }], 150, 4);
  const track = await analyseTempo(onset, FPS, { pause: noPause });
  expect(track).toStrictEqual(analyseBeats(onset, FPS));
  expect(track?.segments.length).toBe(1);
});

test('让出与中止：跑满一段时间就让出一次；让出后发现换曲（isCurrent 给 false）就停下，给 null', async () => {
  const onset = drums([{ from: 0.2, to: 150, bpm: 120 }], 150, 5);
  let pauses = 0;
  const done = await analyseTempo(onset, FPS, {
    pause: async () => {
      pauses += 1;
    },
  });
  expect(done && pauses > 0, String(pauses)).toBe(true);
  let asked = 0;
  const stopped = await analyseTempo(onset, FPS, {
    pause: noPause,
    isCurrent: () => {
      asked += 1;
      return false;
    },
  });
  expect(stopped).toBe(null);
  expect(asked).toBe(1);
});
