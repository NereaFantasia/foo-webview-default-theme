import { createStore } from 'jotai/vanilla';
import { expect, test } from 'vitest';
import type { BinsFrame } from '../../../../src/immersive/spectrum/spectrumBins.ts';
import { TERRAIN_ROWS } from '../../../../src/immersive/terrain/terrain.ts';
import {
  startTerrainHistory,
  TERRAIN_CHAIN_POINTS,
  TERRAIN_DECIMATION,
  TERRAIN_POINTS,
  terrainRetentionFor,
  type TerrainSource,
} from '../../../../src/immersive/terrain/terrainHistory.ts';
import {
  shapeTerrainFrame,
  TERRAIN_RETENTION_PER_60HZ,
} from '../../../../src/immersive/terrain/terrainShape.ts';
import { startPlayback } from '../../../../src/playback/playback.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

/**
 * 山脊图的历史缓冲：来源每报一帧，整形后按 `TERRAIN_DECIMATION` 取顶点推进 120 行缓冲；暂停时不推。
 * 来源是手写的替身，播放状态经宿主替身的事件驱动。
 */
const near = (a: number, b: number, epsilon: number) =>
  expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThan(epsilon);

/** 山脊图那份订阅的帧形：44.1 kHz、16384 点，频点间隔约 2.69 Hz，频点 8（约 21.5 Hz）起到 Nyquist 以下。 */
const SAMPLE_RATE = 44100;
const FFT_SIZE = 16384;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;
const FIRST_BIN = Math.ceil(20 / BIN_HZ);
const BIN_COUNT = FFT_SIZE / 2 - FIRST_BIN;
const SILENT = -160;

/** 一帧频点：`db(k)` 给频点 k 的 dB 功率。 */
const binsFrame = (db: (bin: number) => number): BinsFrame => ({
  values: Array.from({ length: BIN_COUNT }, (_, index) => db(FIRST_BIN + index)),
  firstBin: FIRST_BIN,
  binHz: BIN_HZ,
  nyquist: SAMPLE_RATE / 2,
});

/** 链输出第 `point` 点：同一帧整形后直接比对。 */
function shapedAt(frame: BinsFrame, point: number): number {
  const shaped = new Float32Array(TERRAIN_CHAIN_POINTS);
  shapeTerrainFrame(frame, shaped, new Float32Array(TERRAIN_CHAIN_POINTS));
  return shaped[point * TERRAIN_DECIMATION] ?? -1;
}

/** 手写的帧来源：`emit` 换上新帧（不给就沿用）并通知订阅方。 */
function fakeSource() {
  let frame: BinsFrame | null = null;
  let interval = 1000 / 60;
  const listeners = new Set<() => void>();
  const source: TerrainSource = {
    frame: () => frame,
    interval: () => interval,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    listeners,
    emit(next?: BinsFrame | null) {
      if (next !== undefined) frame = next;
      for (const listener of [...listeners]) listener();
    },
    setInterval(ms: number) {
      interval = ms;
    },
  };
}

test('terrainRetentionFor：60 Hz 一帧留 0.03，帧距翻倍按幂折算，非法帧距不留', () => {
  near(terrainRetentionFor(1000 / 60), TERRAIN_RETENTION_PER_60HZ, 1e-9);
  near(terrainRetentionFor(1000 / 30), TERRAIN_RETENTION_PER_60HZ ** 2, 1e-9);
  expect(terrainRetentionFor(0)).toBe(0);
  expect(terrainRetentionFor(Number.NaN)).toBe(0);
});

test('startTerrainHistory：来源每报一帧就整形一帧、按 TERRAIN_DECIMATION 取顶点推进 120 行缓冲；没帧不推；帧间只留 3%', () => {
  const fake = fakeSource();
  const terrain = startTerrainHistory(createStore(), fake.source);
  expect(terrain.history.rows).toBe(TERRAIN_ROWS);
  expect(TERRAIN_POINTS).toBe(Math.ceil(TERRAIN_CHAIN_POINTS / TERRAIN_DECIMATION));
  expect(terrain.history.bands).toBe(TERRAIN_POINTS);
  fake.emit();
  expect(terrain.history.count).toBe(0);
  const loudFrame = binsFrame(() => -20);
  fake.emit(loudFrame);
  expect(terrain.history.count).toBe(1);
  expect(terrain.version()).toBe(1);
  const loud = terrain.history.row(0)[64] ?? 0;
  expect(loud, `响的一帧 ${loud}`).toBeGreaterThan(0.3);
  // 顶点 64 是链输出第 64 × TERRAIN_DECIMATION 点。
  near(loud, shapedAt(loudFrame, 64), 1e-6);
  const quietFrame = binsFrame(() => -70);
  fake.emit(quietFrame);
  const quiet = shapedAt(quietFrame, 64);
  const retention = TERRAIN_RETENTION_PER_60HZ;
  near(terrain.history.row(0)[64] ?? -1, loud * retention + quiet * (1 - retention), 1e-4);
  expect(terrain.history.row(1)[64]).toBe(loud);
});

test('startTerrainHistory：暂停时来帧不推，版本号与缓冲都不动；恢复后照推', async () => {
  const host = installFakeHost();
  const store = createStore();
  await startPlayback(store, host.fb).ready;
  const fake = fakeSource();
  const terrain = startTerrainHistory(store, fake.source);
  fake.emit(binsFrame(() => -20));
  expect(terrain.history.count).toBe(1);
  const before = [...terrain.history.row(0)];

  // 宿主暂停时照发静音帧：一帧都不该进缓冲。
  host.emit('playback:paused', { paused: true });
  fake.emit(binsFrame(() => SILENT));
  for (let index = 0; index < 4; index += 1) fake.emit();
  expect(terrain.history.count).toBe(1);
  expect(terrain.version()).toBe(1);
  expect([...terrain.history.row(0)]).toStrictEqual(before);

  host.emit('playback:paused', { paused: false });
  fake.emit();
  expect(terrain.history.count).toBe(2);
  expect(terrain.version()).toBe(2);
  expect([...terrain.history.row(1)]).toStrictEqual(before);
});

test('startTerrainHistory：保留量按来源此刻的帧距折算；每推一行叫一次订阅方；释放后不再推', () => {
  const fake = fakeSource();
  const terrain = startTerrainHistory(createStore(), fake.source);
  const seen: number[] = [];
  terrain.subscribe(() => seen.push(terrain.version()));
  const loudFrame = binsFrame(() => -20);
  fake.emit(loudFrame);
  fake.setInterval(1000 / 30);
  const quietFrame = binsFrame(() => -70);
  fake.emit(quietFrame);
  const loud = shapedAt(loudFrame, 64);
  const retention = TERRAIN_RETENTION_PER_60HZ ** 2;
  near(
    terrain.history.row(0)[64] ?? -1,
    loud * retention + shapedAt(quietFrame, 64) * (1 - retention),
    1e-4,
  );
  expect(seen).toStrictEqual([1, 2]);

  terrain.dispose();
  expect(fake.listeners.size).toBe(0);
  fake.emit(loudFrame);
  expect(terrain.history.count).toBe(2);
  expect(terrain.version()).toBe(2);
  expect(seen).toStrictEqual([1, 2]);
});
