// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { atom, createStore } from 'jotai/vanilla';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateAtom } from '../../../src/i18n/locale.ts';
import { ServicesContext, serviceMap } from '../../../src/kit/useService.ts';
import {
  LYRICS_MOTION_PRESET_VALUES,
  lyricsMotionKey,
  type LyricsMotion,
  type LyricsMotionPref,
  type LyricsMotionService,
} from '../../../src/lyrics/lyricsMotion.ts';
import { LyricsMotionExpander } from '../../../src/settings/LyricsMotionExpander.tsx';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

function mount(motion: LyricsMotion) {
  const store = createStore();
  const pref = atom<LyricsMotionPref>({ preset: 'custom', custom: motion });
  const service: LyricsMotionService = {
    persistence: {
      state: atom(new Map()),
      retry: vi.fn(() => Promise.resolve(true)),
      settled: vi.fn(() => Promise.resolve()),
    },
    ready: Promise.resolve(),
    pref,
    motion: atom(motion),
    choosePreset: vi.fn(),
    customize: vi.fn(),
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
          { value: serviceMap([{ key: lyricsMotionKey, value: service }]) },
          createElement(LyricsMotionExpander),
        ),
      ),
    );
  });
  act(() => {
    container.querySelector<HTMLButtonElement>('[data-settings-toggle]')?.click();
  });
  const t = store.get(translateAtom);
  return {
    service,
    shown: (key: Parameters<typeof t>[0]) => (container.textContent ?? '').includes(t(key)),
    spins: () => [...container.querySelectorAll<HTMLInputElement>('input[role="spinbutton"]')],
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const AMLL = LYRICS_MOTION_PRESET_VALUES.amll;

describe('歌词动效卡：从属项按条件出现，不置灰', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom 没有网页动画接口，展开区的滑出动画用它占位
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => ({ finished: Promise.resolve(), cancel() {} })),
    });
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
  });

  afterEach(() => {
    delete environment.IS_REACT_ACT_ENVIRONMENT;
    Reflect.deleteProperty(Element.prototype, 'animate');
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
  });

  it('弹簧与缩放都开：有缩放弹簧的质量、阻尼、刚度，没有过渡时长与曲线', () => {
    const view = mount({ ...AMLL, spring: true, scale: true });
    expect(view.shown('lyrics.mass')).toBe(true);
    expect(view.shown('lyrics.damping')).toBe(true);
    expect(view.shown('lyrics.stiffness')).toBe(true);
    expect(view.shown('lyrics.transitionMs')).toBe(false);
    expect(view.shown('lyrics.transitionCurve')).toBe(false);
    view.unmount();
  });

  it('弹簧关：有过渡时长与四个曲线点，没有缩放弹簧', () => {
    const view = mount({ ...AMLL, spring: false, scale: true });
    expect(view.shown('lyrics.transitionMs')).toBe(true);
    expect(view.shown('lyrics.transitionCurve')).toBe(true);
    expect(view.shown('lyrics.mass')).toBe(false);
    expect(view.shown('lyrics.damping')).toBe(false);
    const names = view.spins().map((input) => input.getAttribute('aria-label'));
    expect(names.filter((name) => name?.includes('x1') || name?.includes('y2'))).toHaveLength(2);
    view.unmount();
  });

  it('弹簧开、缩放关：缩放弹簧与过渡两样都没有', () => {
    const view = mount({ ...AMLL, spring: true, scale: false });
    for (const key of [
      'lyrics.mass',
      'lyrics.stiffness',
      'lyrics.transitionMs',
      'lyrics.transitionCurve',
    ] as const)
      expect(view.shown(key)).toBe(false);
    view.unmount();
  });

  it('没有被禁用的数字框', () => {
    for (const motion of [
      { ...AMLL, spring: true, scale: true },
      { ...AMLL, spring: false, scale: false },
    ]) {
      const view = mount(motion);
      expect(view.spins().length).toBeGreaterThan(0);
      expect(view.spins().every((input) => !input.disabled)).toBe(true);
      view.unmount();
    }
  });
});
