import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { installPrefStorage } from '../../../../../src/kit/localPref.ts';
import {
  ONLINE_SOURCE_PREF,
  onlineSourceOptions,
  startOnlineSources,
} from '../../../../../src/library/search/online/onlineSources.ts';
import type { MusicStatusRead } from '../../../../../src/playback/musicStatus.ts';
import type { MusicLxSource } from '../../../../../src/server/musicLxSources.ts';
import type { MusicStatus } from '../../../../../src/server/musicProtocol.ts';
import type { MusicPlatform } from '../../../../../src/server/musicObjects.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function source(platforms: MusicPlatform[], enabled = true): MusicLxSource {
  return {
    id: 'a.js',
    name: 'A',
    version: '1',
    author: null,
    description: null,
    platforms,
    enabled,
    failed: false,
    error: null,
    health: {},
  };
}

function status(patch: Partial<MusicStatus> = {}): MusicStatusRead {
  return {
    status: 'ready',
    music: {
      platforms: ['tx', 'kw', 'kg', 'mg'],
      ncm: 'missing',
      lx: 'ready',
      lxServer: null,
      lxHosted: true,
      account: null,
      unblock: false,
      ...patch,
    },
  };
}

describe('来源下拉的选项', () => {
  it('网易云永远排第一，状态读不到时只有它', () => {
    expect(onlineSourceOptions(null, null)).toEqual([{ platform: 'wy', available: true }]);
    expect(onlineSourceOptions([], null)).toEqual([{ platform: 'wy', available: true }]);
  });

  it('后端报的平台里有网易云时不重复，其余按固定顺序', () => {
    expect(onlineSourceOptions(['mg', 'wy', 'tx'], null).map((one) => one.platform)).toEqual([
      'wy',
      'tx',
      'mg',
    ]);
  });

  it('音源清单读不到时（自建、没读到）其他平台一律可选', () => {
    expect(onlineSourceOptions(['kw', 'kg'], null)).toEqual([
      { platform: 'wy', available: true },
      { platform: 'kw', available: true },
      { platform: 'kg', available: true },
    ]);
  });

  it('托管时只有被已启用的音源支持的平台可选', () => {
    expect(
      onlineSourceOptions(['tx', 'kw', 'kg', 'mg'], [source(['kw', 'mg']), source(['tx'], false)]),
    ).toEqual([
      { platform: 'wy', available: true },
      { platform: 'tx', available: false },
      { platform: 'kw', available: true },
      { platform: 'kg', available: false },
      { platform: 'mg', available: true },
    ]);
    expect(onlineSourceOptions(['kw'], []).map((one) => one.available)).toEqual([true, false]);
  });
});

function setup(initial: MusicStatusRead = status(), saved: string | null = null) {
  const written = new Map<string, string>();
  if (saved !== null) written.set(ONLINE_SOURCE_PREF_KEY, saved);
  installPrefStorage({
    getItem: (key) => written.get(key) ?? null,
    setItem: (key, value) => void written.set(key, value),
  });
  onTestFinished(() => installPrefStorage(null));
  const store = createStore();
  const state = atom<MusicStatusRead>(initial);
  const reads: { answer(list: MusicLxSource[]): void; fail(): void }[] = [];
  const sources = startOnlineSources(store, {
    status: { state },
    client: {
      lxSources: () =>
        new Promise((resolve, reject) => {
          reads.push({ answer: resolve, fail: () => reject(new Error('读失败')) });
        }),
    },
  });
  onTestFinished(() => sources.dispose());
  return { store, state, sources, reads, written };
}

const ONLINE_SOURCE_PREF_KEY = 'default-theme.online-source.v1';

describe('来源服务', () => {
  it('默认网易云；托管时读音源清单，读到前其他平台可选，读到后按启用的音源判断', async () => {
    const { store, sources, reads } = setup();
    expect(store.get(sources.selected)).toBe('wy');
    expect(reads).toHaveLength(1);
    expect(store.get(sources.options).map((one) => one.available)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    reads[0]?.answer([source(['kw'])]);
    await settle();
    expect(store.get(sources.options).map((one) => [one.platform, one.available])).toEqual([
      ['wy', true],
      ['tx', false],
      ['kw', true],
      ['kg', false],
      ['mg', false],
    ]);
  });

  it('自建的 lxserver 不读音源清单，其他平台都可选', async () => {
    const { store, sources, reads } = setup(status({ lxHosted: false }));
    expect(reads).toHaveLength(0);
    expect(store.get(sources.options).every((one) => one.available)).toBe(true);
  });

  it('选一个可选的来源并记住；不可选的与读不到状态时不动', async () => {
    const { store, state, sources, reads, written } = setup();
    reads[0]?.answer([source(['kw'])]);
    await settle();
    sources.choose('tx');
    expect(store.get(sources.selected)).toBe('wy');
    expect(written.has(ONLINE_SOURCE_PREF_KEY)).toBe(false);
    sources.choose('kw');
    expect(store.get(sources.selected)).toBe('kw');
    expect(written.get(ONLINE_SOURCE_PREF_KEY)).toBe('kw');
    store.set(state, { status: 'failed' });
    expect(store.get(sources.selected)).toBe('wy');
    sources.choose('kw');
    expect(written.get(ONLINE_SOURCE_PREF_KEY)).toBe('kw');
  });

  it('记住的来源不可选时这一次回落到网易云，不改写偏好；又可选时自动回来', async () => {
    const { store, sources, reads, written } = setup(status(), 'kw');
    expect(store.get(ONLINE_SOURCE_PREF.atom)).toBe('kw');
    reads[0]?.answer([source(['tx'])]);
    await settle();
    expect(store.get(sources.selected)).toBe('wy');
    expect(written.get(ONLINE_SOURCE_PREF_KEY)).toBe('kw');
    sources.refresh();
    reads[1]?.answer([source(['kw'])]);
    await settle();
    expect(store.get(sources.selected)).toBe('kw');
  });

  it('后端状态还没读回时先用记住的来源，读回后不可选的才回落到网易云', () => {
    const { store, state, sources } = setup({ status: 'unknown' }, 'kw');
    expect(store.get(sources.selected)).toBe('kw');
    expect(store.get(sources.options).map((one) => one.platform)).toEqual(['wy']);
    store.set(state, status({ platforms: ['tx'] }));
    expect(store.get(sources.selected)).toBe('wy');
    store.set(state, status());
    expect(store.get(sources.selected)).toBe('kw');
    store.set(state, { status: 'failed' });
    expect(store.get(sources.selected)).toBe('wy');
  });

  it('偏好里是认不出的值时按网易云', () => {
    const { store, sources } = setup(status(), 'zz');
    expect(store.get(sources.selected)).toBe('wy');
  });

  it('状态变化时重读，晚到的旧应答丢弃；读失败按读不到处理', async () => {
    const { store, state, sources, reads } = setup();
    store.set(state, status({ platforms: ['kw'] }));
    expect(reads).toHaveLength(2);
    reads[1]?.answer([source(['kw'])]);
    reads[0]?.answer([source(['tx'])]);
    await settle();
    expect(store.get(sources.options).map((one) => [one.platform, one.available])).toEqual([
      ['wy', true],
      ['kw', true],
    ]);
    sources.refresh();
    reads[2]?.fail();
    await settle();
    expect(store.get(sources.options).map((one) => one.available)).toEqual([true, true]);
  });
});
