import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { METER_WINDOW_MS } from '../../../../src/immersive/perf/paintMeter.ts';
import {
  choosePerfOverlay,
  formatPerf,
  loadPerfOverlay,
  perfOverlayEnabledAtom,
  perfTerrainAtom,
  perSecondOf,
  reportTerrain,
  togglePerfOverlay,
  type PerfSnapshot,
} from '../../../../src/immersive/perf/perfOverlay.ts';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';

/** 性能小窗的开关与存档、山脊图回报的去留、四行字的写法。 */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let writes = 0;
  const storage: PrefStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      data.set(key, value);
    },
  };
  return { storage, data, writes: () => writes };
}

const broken: PrefStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

const KEY = 'default-theme.immersive.perfOverlay.v1';

/** 从一个新 store 读回存档里的开关。 */
function readPerfOverlay(storage: PrefStorage | null): boolean {
  const store = createStore();
  loadPerfOverlay(store, storage);
  return store.get(perfOverlayEnabledAtom);
}
const STATS = { paints: 40, totalMs: 100, maxMs: 6, spanMs: 500 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('开关', () => {
  test('默认关；切换写存档，下次按存档开；存档读写抛错时照样切', () => {
    const { storage, data } = memoryStorage();
    const store = createStore();
    expect(store.get(perfOverlayEnabledAtom)).toBe(false);
    loadPerfOverlay(store, storage);
    expect(store.get(perfOverlayEnabledAtom)).toBe(false);
    togglePerfOverlay(store, storage);
    expect(store.get(perfOverlayEnabledAtom)).toBe(true);
    expect(data.get(KEY)).toBe('on');
    const next = createStore();
    loadPerfOverlay(next, storage);
    expect(next.get(perfOverlayEnabledAtom)).toBe(true);
    togglePerfOverlay(store, storage);
    expect(data.get(KEY)).toBe('off');
    expect(readPerfOverlay(storage)).toBe(false);

    const fallback = createStore();
    loadPerfOverlay(fallback, broken);
    expect(fallback.get(perfOverlayEnabledAtom)).toBe(false);
    togglePerfOverlay(fallback, broken);
    expect(fallback.get(perfOverlayEnabledAtom)).toBe(true);
    expect(readPerfOverlay(null)).toBe(false);
    expect(readPerfOverlay(broken)).toBe(false);
  });

  test('存档只认 on，其余写法都按关', () => {
    for (const raw of ['ON', 'true', '1', 'off', '']) {
      expect(readPerfOverlay(memoryStorage({ [KEY]: raw }).storage), raw).toBe(false);
    }
    expect(readPerfOverlay(memoryStorage({ [KEY]: 'on' }).storage)).toBe(true);
  });

  test('choosePerfOverlay 和此刻一样就不写存档', () => {
    const { storage, data, writes } = memoryStorage();
    const store = createStore();
    choosePerfOverlay(store, false, storage);
    expect(writes()).toBe(0);
    choosePerfOverlay(store, true, storage);
    choosePerfOverlay(store, true, storage);
    expect(writes()).toBe(1);
    expect(data.get(KEY)).toBe('on');
    expect(store.get(perfOverlayEnabledAtom)).toBe(true);
  });
});

describe('reportTerrain', () => {
  test('关着时不收山脊图回报；开着时收下并记时刻、带线程与上下文种类；关掉即清空', () => {
    const { storage } = memoryStorage();
    const store = createStore();
    reportTerrain(store, 'worker', 'webgl', STATS, 100);
    expect(store.get(perfTerrainAtom)).toBeNull();
    togglePerfOverlay(store, storage);
    reportTerrain(store, 'main', '2d', STATS, 250);
    expect(store.get(perfTerrainAtom)).toStrictEqual({
      ...STATS,
      thread: 'main',
      surface: '2d',
      at: 250,
    });
    togglePerfOverlay(store, storage);
    expect(store.get(perfTerrainAtom)).toBeNull();
  });

  test('不给时刻时取 performance.now()', () => {
    const store = createStore();
    choosePerfOverlay(store, true, null);
    vi.spyOn(performance, 'now').mockReturnValue(1234);
    reportTerrain(store, 'worker', 'webgl', STATS);
    expect(store.get(perfTerrainAtom)).toStrictEqual({
      ...STATS,
      thread: 'worker',
      surface: 'webgl',
      at: 1234,
    });
  });

  test('读回的存档是关：上一份回报一并清掉', () => {
    const store = createStore();
    choosePerfOverlay(store, true, null);
    reportTerrain(store, 'worker', 'webgl', STATS, 100);
    loadPerfOverlay(store, memoryStorage({ [KEY]: 'off' }).storage);
    expect(store.get(perfOverlayEnabledAtom)).toBe(false);
    expect(store.get(perfTerrainAtom)).toBeNull();
  });
});

describe('formatPerf', () => {
  test('四行字：rAF、LoAF（不支持写 n/a）、山脊图（两窗没回报写 idle）、宿主', () => {
    const snapshot: PerfSnapshot = {
      raf: { perSecond: 164.6, maxGapMs: 7.14 },
      loaf: { perSecond: 2, maxMs: 83.25 },
      hostPerSecond: 59.8,
      terrain: { ...STATS, thread: 'worker', surface: 'webgl', at: 1000 },
    };
    expect(formatPerf(snapshot, 1000)).toStrictEqual([
      'rAF      165/s  max gap 7.1 ms',
      'LoAF       2/s  max 83.3 ms',
      'terrain   80/s  draw 2.5 ms  max 6.0 ms  worker/webgl',
      'host      60/s',
    ]);

    expect(formatPerf(snapshot, 1000 + 2 * METER_WINDOW_MS)[2]).toBe(
      'terrain   80/s  draw 2.5 ms  max 6.0 ms  worker/webgl',
    );
    const stale = formatPerf({ ...snapshot, loaf: null }, 1000 + 2 * METER_WINDOW_MS + 1);
    expect(stale[1]).toBe('LoAF       n/a');
    expect(stale[2]).toBe('terrain   idle  worker/webgl');
    expect(formatPerf({ ...snapshot, terrain: null }, 0)[2]).toBe('terrain   idle');
  });

  test('每秒次数按这一窗实际跨的时长折算；时长为 0 时是 0', () => {
    expect(perSecondOf(40, 500)).toBe(80);
    expect(perSecondOf(3, 0)).toBe(0);
  });
});
