import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import type { PrefStorage } from '../../../src/kit/localPref.ts';
import {
  SETTINGS_SECTION_STORAGE_KEY,
  startSettingsNav,
} from '../../../src/settings/settingsNav.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: PrefStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
  return { storage, items };
}

function start(initial?: Record<string, string>) {
  const store = createStore();
  const { storage, items } = memoryStorage(initial);
  const navigate = vi.fn();
  const nav = startSettingsNav(store, { history: { navigate }, storage });
  return { store, nav, items, navigate };
}

describe('设置页的分区状态', () => {
  it('没有存档或存档无法识别时停在「常规」', () => {
    const fresh = start();
    expect(fresh.store.get(fresh.nav.section)).toBe('general');
    const stale = start({ [SETTINGS_SECTION_STORAGE_KEY]: 'removed-section' });
    expect(stale.store.get(stale.nav.section)).toBe('general');
  });

  it('启动时读取上次所在的分区', () => {
    const { store, nav } = start({ [SETTINGS_SECTION_STORAGE_KEY]: 'lyrics' });
    expect(store.get(nav.section)).toBe('lyrics');
  });

  it('页内切换分区即时生效并写入存档，不跳转到设置地点，也不要求页面落焦点', () => {
    const { store, nav, items, navigate } = start();
    nav.select('appearance');
    expect(store.get(nav.section)).toBe('appearance');
    expect(items.get(SETTINGS_SECTION_STORAGE_KEY)).toBe('appearance');
    expect(store.get(nav.landing)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('从别处进入设置并指定分区：切换分区、跳转到设置地点、等待页面把焦点落到标题', () => {
    const { store, nav, navigate } = start();
    nav.open('online');
    expect(store.get(nav.section)).toBe('online');
    expect(navigate).toHaveBeenCalledWith({ id: 'settings' });
    expect(store.get(nav.landing)).toBe(true);
    nav.landed();
    expect(store.get(nav.landing)).toBe(false);
  });

  it('已在该分区时再次进入该分区，仍要求页面落一次焦点', () => {
    const { store, nav } = start({ [SETTINGS_SECTION_STORAGE_KEY]: 'lyrics' });
    nav.open('lyrics');
    expect(store.get(nav.landing)).toBe(true);
  });
});
