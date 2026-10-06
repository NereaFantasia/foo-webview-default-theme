import { expect, test } from 'vitest';
import { barAxisFor } from '../../../../src/immersive/spectrum/barAxis.ts';
import {
  BAR_PARTS,
  BIN_FLOOR_DB,
  barsOfBins,
  binsFrameOf,
  type BinsFrame,
} from '../../../../src/immersive/spectrum/spectrumBins.ts';

const near = (a: number, b: number, epsilon: number) =>
  expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(epsilon);

/** 宿主应答的形状：48 kHz、8192 点，频点 4 起（20 Hz 以下的 0…3 不出）。 */
const answer = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  success: true,
  output: 'bins',
  channels: 'mix',
  channelCount: 2,
  firstBin: 4,
  fftSize: 8192,
  sampleRate: 48000,
  maxFrequency: 24000,
  scale: 'db',
  spectrum: [-20, -30],
  ...extra,
});

/** 一帧：频点间隔 `binHz`、从频点 `firstBin` 起，`values(k)` 给频点 k 的 dB。 */
function frameOf(
  binHz: number,
  firstBin: number,
  count: number,
  values: (bin: number) => number,
): BinsFrame {
  return {
    values: Array.from({ length: count }, (_, index) => values(firstBin + index)),
    firstBin,
    binHz,
    nyquist: binHz * (firstBin + count),
  };
}

test('binsFrameOf：认频点帧，频点间隔与 Nyquist 由采样率与点数算出', () => {
  expect(binsFrameOf(answer())).toStrictEqual({
    values: [-20, -30],
    firstBin: 4,
    binHz: 48000 / 8192,
    nyquist: 24000,
  });
  // 静音帧沿用上一帧的长度，值全在下限：照样是一帧。
  expect(binsFrameOf(answer({ spectrum: [BIN_FLOOR_DB] }))?.values).toStrictEqual([BIN_FLOOR_DB]);
});

test('binsFrameOf：频带帧、旧宿主不带 output 的帧、双声道帧、采样率未知与坏值都不认', () => {
  expect(binsFrameOf(answer({ output: 'bands' }))).toBeNull();
  expect(
    binsFrameOf({ success: true, spectrum: [0.5], fftSize: 8192, sampleRate: 48000 }),
  ).toBeNull();
  const stereo = answer({ channels: 'stereo', left: [-20], right: [-20] });
  delete stereo.spectrum;
  expect(binsFrameOf(stereo)).toBeNull();
  expect(binsFrameOf(answer({ sampleRate: 0 }))).toBeNull();
  expect(binsFrameOf(answer({ fftSize: 0 }))).toBeNull();
  expect(binsFrameOf(answer({ firstBin: -1 }))).toBeNull();
  expect(binsFrameOf(answer({ firstBin: 1.5 }))).toBeNull();
  expect(binsFrameOf(answer({ spectrum: [-20, 'x'] }))).toBeNull();
  expect(binsFrameOf(answer({ spectrum: [-20, Number.NaN] }))).toBeNull();
  expect(binsFrameOf(null)).toBeNull();
  expect(binsFrameOf('bins')).toBeNull();
});

/** 频谱柱那份的帧形：44.1 kHz、8192 点，频点 4（21.5 Hz）起到 Nyquist 以下；轴照它铺 200 根柱。 */
const RATE = 44100;
const FFT = 8192;
const BIN_HZ = RATE / FFT;
const FIRST = Math.ceil(20 / BIN_HZ);
const axis = barAxisFor(RATE, FFT, 200, 20);
const barsFrame = (db: (bin: number) => number): BinsFrame =>
  frameOf(BIN_HZ, FIRST, FFT / 2 - FIRST, db);

test('barsOfBins：线性段一根柱就是它自己的频点，相邻两根读数不同', () => {
  const out = new Float32Array(200);
  barsOfBins(
    barsFrame((bin) => -bin / 10),
    axis,
    out,
  );
  expect(axis.binBars, `线性段 ${axis.binBars} 根`).toBeGreaterThan(20);
  for (let bar = 0; bar < axis.binBars; bar += 1) {
    near(out[bar] ?? 0, -(FIRST + bar) / 10, 1e-4);
  }
  // 连同对数段的第一根：交界两侧也不共用频点。
  for (let bar = 1; bar <= axis.binBars; bar += 1) {
    expect(out[bar], `第 ${bar} 根与前一根读同一个值`).not.toBe(out[bar - 1]);
  }
});

test(`barsOfBins：对数段每根柱分 ${BAR_PARTS} 份、取功率之和最大的一份；同一份里两个 −3 dB 频点并成 0 dB`, () => {
  const bar = 150;
  const low = axis.edges[bar] ?? 0;
  const high = axis.edges[bar + 1] ?? 0;
  const partEnd = low * (high / low) ** (1 / BAR_PARTS);
  const bin = Math.ceil(low / BIN_HZ);
  expect((bin + 1) * BIN_HZ, '两个频点都落在第一份里').toBeLessThan(partEnd);
  const out = new Float32Array(200);
  barsOfBins(
    barsFrame((index) => (index === bin || index === bin + 1 ? -3.0103 : BIN_FLOOR_DB)),
    axis,
    out,
  );
  near(out[bar] ?? -1, 0, 1e-3);
  // 恒 −30 dB 时柱值是 −30 加上最大那一份频点数的 10·log10，比单个频点高、比整根柱的功率和低。
  barsOfBins(
    barsFrame(() => -30),
    axis,
    out,
  );
  const binsInBar = Math.ceil(high / BIN_HZ) - Math.ceil(low / BIN_HZ);
  expect(out[bar] ?? 0).toBeGreaterThan(-30);
  expect(out[bar] ?? 0).toBeLessThan(-30 + 10 * Math.log10(binsInBar));
});

test('barsOfBins：帧的点数比轴稀时，没有频点的柱取离柱中心最近的频点，不插值', () => {
  // 1024 点的帧（频点间隔约 43 Hz）铺 8192 点的轴：线性段的柱大多一个频点都没有。
  const coarse = RATE / 1024;
  const frame = frameOf(coarse, 1, 511, (bin) => -bin);
  const out = new Float32Array(200);
  barsOfBins(frame, axis, out);
  for (let bar = 0; bar < axis.binBars; bar += 1) {
    const low = axis.edges[bar] ?? 0;
    const high = axis.edges[bar + 1] ?? 0;
    if (Math.ceil(low / coarse) < Math.ceil(high / coarse)) continue;
    const nearest = Math.min(511, Math.max(1, Math.round(Math.sqrt(low * high) / coarse)));
    expect(out[bar], `第 ${bar} 根`).toBe(-nearest);
  }
});

test('barsOfBins：空帧全是下限；输出比轴长的部分补下限', () => {
  const out = new Float32Array(4).fill(1);
  barsOfBins({ values: [], firstBin: 0, binHz: BIN_HZ, nyquist: RATE / 2 }, axis, out);
  expect([...out]).toStrictEqual([BIN_FLOOR_DB, BIN_FLOOR_DB, BIN_FLOOR_DB, BIN_FLOOR_DB]);
  const longer = new Float32Array(202).fill(1);
  barsOfBins(
    barsFrame(() => -30),
    axis,
    longer,
  );
  expect([...longer.subarray(200)]).toStrictEqual([BIN_FLOOR_DB, BIN_FLOOR_DB]);
});
