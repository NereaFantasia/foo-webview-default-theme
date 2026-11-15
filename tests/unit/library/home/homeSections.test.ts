import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it } from 'vitest';
import { installPrefStorage } from '../../../../src/kit/localPref.ts';
import {
  HOME_SECTIONS,
  HOME_SECTIONS_KEY,
  homeHiddenSectionsAtom,
  homeLayoutAtom,
  loadHomeSections,
  placeHomeSection,
  resetHomeSections,
  showHomeSection,
} from '../../../../src/library/home/homeSections.ts';

function memoryStorage(initial?: string) {
  const saved = new Map<string, string>();
  if (initial !== undefined) saved.set(HOME_SECTIONS_KEY, initial);
  installPrefStorage({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  });
  return saved;
}

const DEFAULT_ORDER = HOME_SECTIONS.map(({ id }) => id);
const orderOf = (store: ReturnType<typeof createStore>) =>
  store.get(homeLayoutAtom).map(({ id }) => id);

afterEach(() => installPrefStorage(null));

describe('首页区块的显隐与次序', () => {
  it('没有存档时按缺省次序全开', () => {
    memoryStorage();
    const store = createStore();
    loadHomeSections(store);
    expect(orderOf(store)).toEqual(DEFAULT_ORDER);
    expect(store.get(homeHiddenSectionsAtom)).toEqual([]);
  });

  it('存档里认不出与重复的名字丢掉，没写到的行补在末尾且开着，开着的行排在关掉的行前面', () => {
    memoryStorage('gems,-charts,explore,,gems,banners');
    const store = createStore();
    loadHomeSections(store);
    const rest = DEFAULT_ORDER.filter((id) => !['gems', 'charts', 'banners'].includes(id));
    expect(orderOf(store)).toEqual(['gems', 'banners', ...rest, 'charts']);
    expect(store.get(homeHiddenSectionsAtom)).toEqual(['charts']);
  });

  it('关掉与打开立即生效并落盘，打开的行排在开着的行末尾，下次启动读回', () => {
    const saved = memoryStorage();
    const store = createStore();
    loadHomeSections(store);
    showHomeSection(store, 'quick', false);
    showHomeSection(store, 'banners', false);
    expect(store.get(homeHiddenSectionsAtom)).toEqual(['quick', 'banners']);
    expect(orderOf(store).slice(-2)).toEqual(['quick', 'banners']);
    showHomeSection(store, 'quick', true);
    expect(orderOf(store)).toEqual([
      ...DEFAULT_ORDER.filter((id) => id !== 'quick' && id !== 'banners'),
      'quick',
      'banners',
    ]);
    expect(store.get(homeHiddenSectionsAtom)).toEqual(['banners']);
    expect(saved.get(HOME_SECTIONS_KEY)?.split(',')).toContain('-banners');
    const next = createStore();
    loadHomeSections(next);
    expect(orderOf(next)).toEqual(orderOf(store));
    expect(next.get(homeHiddenSectionsAtom)).toEqual(['banners']);
  });

  it('挪动只排开着的行：插在第 k 行之前，关掉的行始终在末尾，换了次序下次启动读回', () => {
    memoryStorage();
    const store = createStore();
    loadHomeSections(store);
    showHomeSection(store, 'banners', false);
    placeHomeSection(store, 'overview', 0);
    expect(orderOf(store).slice(0, 3)).toEqual(['overview', 'quick', 'added']);
    placeHomeSection(store, 'overview', 3);
    expect(orderOf(store).slice(0, 3)).toEqual(['quick', 'added', 'overview']);
    expect(orderOf(store).at(-1)).toBe('banners');
    const next = createStore();
    loadHomeSections(next);
    expect(orderOf(next)).toEqual(orderOf(store));
  });

  it('落在原位、越界或这一行没开着时不动也不写存档', () => {
    const saved = memoryStorage();
    const store = createStore();
    loadHomeSections(store);
    placeHomeSection(store, 'quick', 0);
    placeHomeSection(store, 'quick', 1);
    placeHomeSection(store, 'quick', 99);
    expect(orderOf(store)).toEqual(DEFAULT_ORDER);
    showHomeSection(store, 'gems', false);
    const before = saved.get(HOME_SECTIONS_KEY);
    placeHomeSection(store, 'gems', 0);
    expect(saved.get(HOME_SECTIONS_KEY)).toBe(before);
  });

  it('恢复默认：缺省次序、全部打开', () => {
    memoryStorage();
    const store = createStore();
    loadHomeSections(store);
    showHomeSection(store, 'gems', false);
    placeHomeSection(store, 'overview', 0);
    resetHomeSections(store);
    expect(orderOf(store)).toEqual(DEFAULT_ORDER);
    expect(store.get(homeHiddenSectionsAtom)).toEqual([]);
  });
});
