import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  amplitudeOf,
  chooseVolumeScale,
  dbOf,
  DEFAULT_VOLUME_SCALE,
  loadVolumeScale,
  MUTE_DB,
  positionOf,
  volumeScaleAtom,
} from '../../../src/playback/volumeScale.ts';
import type { PrefStorage } from '../../../src/kit/localPref.ts';

describe('volumeScale', () => {
  it('两档刻度在两端都对得上 fb2k：0 是静音，100 是满', () => {
    for (const scale of ['perceptual', 'db'] as const) {
      expect(dbOf(0, scale)).toBeCloseTo(MUTE_DB);
      expect(dbOf(100, scale)).toBeCloseTo(0);
      expect(positionOf(MUTE_DB, scale)).toBe(0);
      expect(positionOf(0, scale)).toBeCloseTo(100);
    }
  });

  it('dB 与位置来回换得回来；静音以下与 NaN 都是 0', () => {
    for (const scale of ['perceptual', 'db'] as const) {
      for (const position of [5, 37.5, 80]) {
        expect(positionOf(dbOf(position, scale), scale)).toBeCloseTo(position);
      }
      expect(positionOf(-120, scale)).toBe(0);
      expect(positionOf(Number.NaN, scale)).toBe(0);
    }
  });

  it('听感刻度把日常音量放在条的中段', () => {
    expect(positionOf(-10, 'perceptual')).toBeGreaterThan(55);
    expect(positionOf(-10, 'db')).toBe(90);
  });

  it('给宿主的是线性幅度百分比，静音及以下是 0', () => {
    expect(amplitudeOf(0)).toBe(100);
    expect(amplitudeOf(-20)).toBeCloseTo(10);
    expect(amplitudeOf(MUTE_DB)).toBe(0);
    expect(amplitudeOf(-150)).toBe(0);
  });

  it('读存档只认表里的值，存储出错也回到缺省', () => {
    const readVolumeScale = (storage: PrefStorage | null) => {
      const store = createStore();
      loadVolumeScale(store, storage);
      return store.get(volumeScaleAtom);
    };
    const storage = (value: string | null) => ({ getItem: () => value, setItem: () => {} });
    expect(readVolumeScale(storage('db'))).toBe('db');
    expect(readVolumeScale(storage('loud'))).toBe(DEFAULT_VOLUME_SCALE);
    expect(readVolumeScale(null)).toBe(DEFAULT_VOLUME_SCALE);
    const broken = {
      getItem(): string | null {
        throw new Error('storage disabled');
      },
      setItem() {},
    };
    expect(readVolumeScale(broken)).toBe(DEFAULT_VOLUME_SCALE);
  });
});

describe('chooseVolumeScale', () => {
  function memoryStorage() {
    const saved = new Map<string, string>();
    return {
      saved,
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
    };
  }

  it('换刻度立即生效并落盘，下次启动读回的是它', () => {
    const storage = memoryStorage();
    const store = createStore();
    loadVolumeScale(store, storage);
    expect(store.get(volumeScaleAtom)).toBe(DEFAULT_VOLUME_SCALE);
    chooseVolumeScale(store, 'db', storage);
    expect(store.get(volumeScaleAtom)).toBe('db');

    const next = createStore();
    loadVolumeScale(next, storage);
    expect(next.get(volumeScaleAtom)).toBe('db');
  });

  it('和此刻一样就不写存档', () => {
    const storage = memoryStorage();
    const store = createStore();
    chooseVolumeScale(store, DEFAULT_VOLUME_SCALE, storage);
    expect(storage.saved.size).toBe(0);
  });

  it('存储被禁或写满时这一次照常生效', () => {
    const store = createStore();
    const full = {
      getItem: () => null,
      setItem(): void {
        throw new Error('QuotaExceededError');
      },
    };
    chooseVolumeScale(store, 'db', full);
    expect(store.get(volumeScaleAtom)).toBe('db');
    chooseVolumeScale(store, 'perceptual', null);
    expect(store.get(volumeScaleAtom)).toBe('perceptual');
  });
});
