// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useContentFit } from '../../../src/kit/useContentFit.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const observers: (() => void)[] = [];

/** 只记下回调、由测试手动触发的观察器，jsdom 没有 ResizeObserver */
class FakeResizeObserver implements ResizeObserver {
  private readonly fire = () => this.callback([], this);
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    observers.push(this.fire);
  }
  unobserve(): void {}
  disconnect(): void {
    observers.splice(observers.indexOf(this.fire), 1);
  }
}

/** jsdom 不排版：宽由测试直接给 */
function sizedBox(client: number, scroll: number) {
  const box = document.createElement('div');
  const sizes = { client, scroll };
  Object.defineProperty(box, 'clientWidth', { get: () => sizes.client });
  Object.defineProperty(box, 'scrollWidth', { get: () => sizes.scroll });
  return { box, sizes };
}

describe('useContentFit', () => {
  let environment: ActEnvironment;
  let root: Root;
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = FakeResizeObserver;
    root = createRoot(document.createElement('div'));
  });
  afterEach(() => {
    act(() => root.unmount());
    globalThis.ResizeObserver = original;
    observers.length = 0;
    environment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  function mount(box: HTMLElement | null, enabled = true, key = 'names') {
    const host = createRef<HTMLElement>();
    host.current = box;
    const seen = { fits: true };
    function Probe(props: { enabled: boolean; keyName: string }) {
      seen.fits = useContentFit(host, props.enabled, props.keyName);
      return null;
    }
    const render = (next = { enabled, key }) =>
      act(() => root.render(createElement(Probe, { enabled: next.enabled, keyName: next.key })));
    render();
    return { seen, render };
  }
  const resized = () => act(() => observers.forEach((fire) => fire()));

  it('铺得下就一直是 true', () => {
    const { box } = sizedBox(120, 120);
    const { seen } = mount(box);
    expect(seen.fits).toBe(true);
    resized();
    expect(seen.fits).toBe(true);
  });

  it('量到铺不下就是 false，宽到铺开所需的数才回来，中间不来回', () => {
    const { box, sizes } = sizedBox(100, 220);
    const { seen } = mount(box);
    expect(seen.fits).toBe(false);
    // 收成小形态后字宽变了也不影响：看的是记下的铺开宽 220
    sizes.scroll = 150;
    sizes.client = 160;
    resized();
    expect(seen.fits).toBe(false);
    sizes.client = 218;
    resized();
    expect(seen.fits).toBe(false);
    sizes.client = 221;
    resized();
    expect(seen.fits).toBe(true);
  });

  it('差 1 以内是取整的舍入，不算放不下', () => {
    const { box } = sizedBox(130, 131);
    expect(mount(box).seen.fits).toBe(true);
  });

  it('不启用或没有这一层时恒为 true，也不监听', () => {
    const { box } = sizedBox(10, 500);
    expect(mount(box, false).seen.fits).toBe(true);
    expect(observers).toHaveLength(0);
    act(() => root.unmount());
    root = createRoot(document.createElement('div'));
    expect(mount(null).seen.fits).toBe(true);
  });

  it('换了内容就从铺开的形态重新量', () => {
    const { box, sizes } = sizedBox(100, 220);
    const { seen, render } = mount(box);
    expect(seen.fits).toBe(false);
    sizes.client = 100;
    sizes.scroll = 90;
    render({ enabled: true, key: 'other names' });
    expect(seen.fits).toBe(true);
  });
});
