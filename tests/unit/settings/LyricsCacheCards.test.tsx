// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { atom, createStore } from 'jotai/vanilla';
import { act, createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateAtom } from '../../../src/i18n/locale.ts';
import { ServicesContext, serviceMap } from '../../../src/kit/useService.ts';
import {
  lyricsCacheKey,
  type LyricsCachePref,
  type LyricsCacheService,
  type LyricsCacheUsage,
} from '../../../src/lyrics/lyricsCache.ts';
import { LyricsCacheCard, LyricsRememberCard } from '../../../src/settings/LyricsCacheCards.tsx';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

function mount(
  options: { available?: boolean; usage?: LyricsCacheUsage; remember?: boolean } = {},
) {
  const store = createStore();
  const pref = atom<LyricsCachePref>({
    remember: options.remember ?? true,
    enabled: true,
    limitMb: 50,
  });
  const cache: LyricsCacheService = {
    pref,
    persistence: {
      state: atom(new Map()),
      retry: vi.fn(() => Promise.resolve(true)),
      settled: vi.fn(() => Promise.resolve()),
    },
    ready: Promise.resolve(),
    available: atom(options.available ?? true),
    usage: atom<LyricsCacheUsage>(options.usage ?? { status: 'loading' }),
    lookup: vi.fn(() => Promise.resolve(undefined)),
    store: vi.fn(),
    refreshUsage: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve(true)),
    setRemember: vi.fn(() => Promise.resolve(true)),
    setEnabled: vi.fn(() => Promise.resolve(true)),
    setLimit: vi.fn(() => Promise.resolve(true)),
    dispose: vi.fn(),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        Provider,
        { store },
        createElement(
          ServicesContext,
          { value: serviceMap([{ key: lyricsCacheKey, value: cache }]) },
          createElement(
            Fragment,
            null,
            createElement(LyricsRememberCard),
            createElement(LyricsCacheCard),
          ),
        ),
      ),
    );
  });
  return {
    t: store.get(translateAtom),
    cache,
    text: () => container.textContent ?? '',
    switches: () => [...container.querySelectorAll<HTMLInputElement>('input[role="switch"]')],
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('歌词缓存设置卡', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('本地服务连着时读占用，说明行写条数与大小；两个开关都可用', () => {
    const view = mount({ usage: { status: 'ready', count: 386, bytes: 12.4 * 1024 * 1024 } });
    expect(view.cache.refreshUsage).toHaveBeenCalled();
    expect(view.text()).toContain(view.t('lyrics.cacheUsage', { count: 386, size: '12.4' }));
    expect(view.switches()).toHaveLength(2);
    expect(view.switches().every((item) => !item.disabled)).toBe(true);
    view.unmount();
  });

  it('count 为 1 时使用单数文案', () => {
    const view = mount({ usage: { status: 'ready', count: 1, bytes: 1.5 * 1024 * 1024 } });
    expect(view.text()).toContain(view.t('lyrics.cacheUsageOne', { count: 1, size: '1.5' }));
    view.unmount();
  });

  it('本地服务没连着时写明不可用，缓存开关禁用，默认记住的开关照常可用', () => {
    const view = mount({ available: false });
    expect(view.cache.refreshUsage).not.toHaveBeenCalled();
    expect(view.text()).toContain(view.t('lyrics.cacheUnavailable'));
    const [remember, enabled] = view.switches();
    expect(remember?.disabled).toBe(false);
    expect(enabled?.disabled).toBe(true);
    view.unmount();
  });

  it('读取失败与清理失败分开写', () => {
    const read = mount({ usage: { status: 'failed' } });
    expect(read.text()).toContain(read.t('lyrics.cacheReadFailed'));
    read.unmount();
    const clear = mount({ usage: { status: 'clear-failed' } });
    expect(clear.text()).toContain(clear.t('lyrics.cacheClearFailed'));
    clear.unmount();
  });

  it('开关改默认记住与缓存开关，交给服务保存', () => {
    const view = mount();
    const [remember, enabled] = view.switches();
    act(() => remember?.click());
    expect(view.cache.setRemember).toHaveBeenCalledWith(false);
    act(() => enabled?.click());
    expect(view.cache.setEnabled).toHaveBeenCalledWith(false);
    view.unmount();
  });
});
