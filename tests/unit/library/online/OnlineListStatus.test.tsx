// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { atom, createStore } from 'jotai/vanilla';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateAtom } from '../../../../src/i18n/locale.ts';
import { ServicesContext, serviceMap } from '../../../../src/kit/useService.ts';
import {
  OnlineFailureView,
  OnlineNotice,
} from '../../../../src/library/online/OnlineListStatus.tsx';
import { platformName } from '../../../../src/playback/musicPlatforms.ts';
import { musicStatusKey, type MusicStatusService } from '../../../../src/playback/musicStatus.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  vi.unstubAllGlobals();
});

/** jsdom 没有 ResizeObserver，Fluent 的警告条挂上时要用 */
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mount(element: ReactElement, reconnect = vi.fn(() => Promise.resolve())) {
  (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', NoResize);
  const store = createStore();
  const status: MusicStatusService = {
    state: atom({ status: 'unknown' as const }),
    refresh: vi.fn(),
    apply: vi.fn(),
    reconnect,
    dispose: vi.fn(),
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        Provider,
        { store },
        createElement(
          ServicesContext,
          { value: serviceMap([{ key: musicStatusKey, value: status }]) },
          element,
        ),
      ),
    );
  });
  unmounts.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    t: store.get(translateAtom),
    button: (label: string) =>
      [...container.querySelectorAll('button')].find((node) => node.textContent === label),
  };
}

describe('在线内容取失败时的页面状态', () => {
  it('其余失败写标题与已知的原因，点重试交给调用方', () => {
    const retry = vi.fn();
    const view = mount(
      createElement(OnlineFailureView, { failure: 'timeout', retry, title: '读取失败' }),
    );
    expect(view.container.textContent).toContain('读取失败');
    expect(view.container.textContent).toContain(
      view.t('online.reason.timeout', { platform: platformName(view.t, 'wy') }),
    );
    act(() => view.button(view.t('album.retry'))?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('没有失败码时只写标题，仍可重试', () => {
    const view = mount(
      createElement(OnlineFailureView, { failure: null, retry: vi.fn(), title: '读取失败' }),
    );
    expect(view.container.textContent).toBe('读取失败' + view.t('album.retry'));
  });

  it('给了「没有这个对象」的标题时，对象不存在单独写这一句，没有重试', () => {
    const view = mount(
      createElement(OnlineFailureView, {
        failure: 'not-found',
        retry: vi.fn(),
        title: '读取失败',
        missing: '网易云上没有这位艺人',
      }),
    );
    expect(view.container.textContent).toBe('网易云上没有这位艺人');
    expect(view.button(view.t('album.retry'))).toBeUndefined();
  });

  it('没给「没有这个对象」的标题时，对象不存在与其余失败一样可重试', () => {
    const view = mount(
      createElement(OnlineFailureView, { failure: 'not-found', retry: vi.fn(), title: '读取失败' }),
    );
    expect(view.container.textContent).toContain('读取失败');
    expect(view.button(view.t('album.retry'))).toBeDefined();
  });

  it('服务连不上时先让后端重连，再交给调用方重发请求', async () => {
    const order: string[] = [];
    const reconnect = vi.fn(() => {
      order.push('reconnect');
      return Promise.resolve();
    });
    const retry = vi.fn(() => order.push('retry'));
    const view = mount(
      createElement(OnlineFailureView, {
        failure: 'backend-unavailable',
        retry,
        title: '读取失败',
      }),
      reconnect,
    );
    expect(view.container.textContent).toContain(view.t('online.unavailableTitle'));
    await act(async () => view.button(view.t('album.retry'))?.click());
    expect(order).toEqual(['reconnect', 'retry']);
  });
});

describe('在线列表页的警告条', () => {
  it('写那条文案，点关闭交给调用方', () => {
    const onDismiss = vi.fn();
    const view = mount(createElement(OnlineNotice, { notice: 'online.queueFailed', onDismiss }));
    expect(view.container.textContent).toContain(view.t('online.queueFailed'));
    act(() => view.button(view.t('album.dismiss'))?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
