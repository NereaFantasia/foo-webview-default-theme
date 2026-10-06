import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoverReveal } from '../../../../src/shell/player/hoverReveal.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function reveal() {
  const changes: boolean[] = [];
  const panel = createHoverReveal({
    openMs: 300,
    closeMs: 500,
    onChange: (open) => changes.push(open),
  });
  return { panel, changes };
}

describe('createHoverReveal', () => {
  it('停够 300 ms 才展开，没停够就离开不展开', () => {
    const { panel, changes } = reveal();
    panel.enter();
    vi.advanceTimersByTime(299);
    panel.leave();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
    panel.enter();
    vi.advanceTimersByTime(300);
    expect(changes).toEqual([true]);
  });

  it('离开 500 ms 后收回，其间回来就不收', () => {
    const { panel, changes } = reveal();
    panel.show();
    panel.leave();
    vi.advanceTimersByTime(400);
    panel.enter();
    vi.advanceTimersByTime(1000);
    expect(panel.open).toBe(true);
    panel.leave();
    vi.advanceTimersByTime(500);
    expect(changes).toEqual([true, false]);
  });

  it('拖滑条、焦点在里面时不收；都放开时指针在外面，再等 500 ms 收', () => {
    const { panel, changes } = reveal();
    panel.enter();
    vi.advanceTimersByTime(300);
    panel.hold('drag', true);
    panel.hold('focus', true);
    panel.leave();
    vi.advanceTimersByTime(2000);
    panel.hold('drag', false);
    vi.advanceTimersByTime(2000);
    expect(panel.open).toBe(true);
    panel.hold('focus', false);
    vi.advanceTimersByTime(499);
    expect(panel.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true, false]);
  });

  it('按住的理由放开时指针还在里面，不收', () => {
    const { panel } = reveal();
    panel.enter();
    vi.advanceTimersByTime(300);
    panel.hold('drag', true);
    panel.hold('drag', false);
    vi.advanceTimersByTime(2000);
    expect(panel.open).toBe(true);
  });

  it('轻关立刻收回、清掉按住；释放后定时器不再触发', () => {
    const { panel, changes } = reveal();
    panel.show();
    panel.hold('focus', true);
    panel.dismiss();
    expect(changes).toEqual([true, false]);
    panel.enter();
    panel.dispose();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true, false]);
  });
});
