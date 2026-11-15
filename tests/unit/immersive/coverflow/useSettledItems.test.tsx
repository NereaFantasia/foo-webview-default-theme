// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettledItems } from '../../../../src/immersive/coverflow/useSettledItems.ts';

function Probe(props: { items: string; settling: boolean }) {
  return <div data-testid="shown">{useSettledItems(props.items, props.settling)}</div>;
}

describe('useSettledItems', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const shown = () => container.querySelector('[data-testid="shown"]')?.textContent;
  const render = (items: string, settling: boolean) =>
    act(() => root.render(<Probe items={items} settling={settling} />));

  it('读取期间沿用上一份，读好后一次换成新的，不读取时直接跟着变化', () => {
    render('A', false);
    render('B', false);
    expect(shown()).toBe('B');
    // 换曲：正在播放已是新的，两边还在读
    render('B 带旧的两边', true);
    expect(shown()).toBe('B');
    render('B 带半新的两边', true);
    expect(shown()).toBe('B');
    render('C', false);
    expect(shown()).toBe('C');
  });

  it('读取一直不成功时也不能无限期沿用上一份，超时后放行，读取完成后下一次又能沿用上一份', async () => {
    render('A', false);
    render('B', true);
    expect(shown()).toBe('A');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(shown()).toBe('B');
    render('C', false);
    render('D', true);
    expect(shown()).toBe('C');
  });
});
