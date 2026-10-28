// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWidthTier, type WidthTier } from '../../../src/kit/useWidthTier.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

type Step = 'full' | 'bare';
type Tiers = readonly [WidthTier<Step>, ...WidthTier<Step>[]];

const LOOSE: Tiers = [
  { tier: 'full', min: 200 },
  { tier: 'bare', min: 0 },
];
const STRICT: Tiers = [
  { tier: 'full', min: 300 },
  { tier: 'bare', min: 0 },
];

const reports: { fire(width: number): void }[] = [];

/** 只记下回调、由测试手动触发的观察器，jsdom 没有 ResizeObserver */
class FakeResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    reports.push({ fire: (width) => this.callback([entryOf(width)], this) });
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function entryOf(width: number): ResizeObserverEntry {
  const rect: DOMRectReadOnly = {
    x: 0,
    y: 0,
    width,
    height: 10,
    top: 0,
    left: 0,
    right: width,
    bottom: 10,
    toJSON: () => ({}),
  };
  return {
    target: document.body,
    contentRect: rect,
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  };
}

describe('useWidthTier 换档表', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    reports.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('换成另一张档表：按最近一次量到的宽度重新取档，宽度没变也跟着变', () => {
    const root = createRoot(document.createElement('div'));
    const seen: { tier: Step } = { tier: 'full' };
    function Harness({ tiers }: { readonly tiers: Tiers }) {
      const [ref, tier] = useWidthTier<Step, HTMLDivElement>(tiers);
      seen.tier = tier;
      return createElement('div', { ref });
    }
    act(() => root.render(createElement(Harness, { tiers: LOOSE })));
    act(() => reports[0]?.fire(250));
    expect(seen.tier).toBe('full');
    act(() => root.render(createElement(Harness, { tiers: STRICT })));
    expect(seen.tier).toBe('bare');
    act(() => root.render(createElement(Harness, { tiers: LOOSE })));
    expect(seen.tier).toBe('full');
    act(() => root.unmount());
  });

  it('还没量到宽度就换表：取新表里最宽的一档', () => {
    const root = createRoot(document.createElement('div'));
    const seen: { tier: Step } = { tier: 'bare' };
    function Harness({ tiers }: { readonly tiers: Tiers }) {
      const [ref, tier] = useWidthTier<Step, HTMLDivElement>(tiers);
      seen.tier = tier;
      return createElement('div', { ref });
    }
    act(() => root.render(createElement(Harness, { tiers: STRICT })));
    act(() => root.render(createElement(Harness, { tiers: LOOSE })));
    expect(seen.tier).toBe('full');
    act(() => root.unmount());
  });

  it('档内的宽度波动不重新渲染', () => {
    const root = createRoot(document.createElement('div'));
    let renders = 0;
    function Harness() {
      const [ref] = useWidthTier<Step, HTMLDivElement>(LOOSE);
      renders += 1;
      return createElement('div', { ref });
    }
    act(() => root.render(createElement(Harness)));
    act(() => reports[0]?.fire(220));
    const before = renders;
    act(() => reports[0]?.fire(260));
    act(() => reports[0]?.fire(400));
    expect(renders).toBe(before);
    act(() => root.unmount());
  });
});
