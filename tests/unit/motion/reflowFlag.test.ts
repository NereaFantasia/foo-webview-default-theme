import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReflowFlag } from '../../../src/motion/reflowFlag.ts';
import { DURATION_MS } from '../../../src/motion/timing.ts';

afterEach(() => {
  vi.useRealTimers();
});

function setup(reduced = false) {
  vi.useFakeTimers();
  const changes: boolean[] = [];
  const flag = createReflowFlag({ reduced: () => reduced, onChange: (on) => changes.push(on) });
  return { flag, changes };
}

describe('createReflowFlag', () => {
  it('列数变了亮一个过渡时长再多一点，到点熄灭', () => {
    const { flag, changes } = setup();
    flag.update(4);
    flag.update(5);
    expect(flag.reflowing).toBe(true);
    vi.advanceTimersByTime(DURATION_MS.normal);
    expect(flag.reflowing).toBe(true);
    vi.advanceTimersByTime(50);
    expect(flag.reflowing).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('从没量出宽度到第一个列数不算换；列数不变不亮', () => {
    const { flag, changes } = setup();
    flag.update(0);
    flag.update(4);
    flag.update(4);
    expect(changes).toEqual([]);
  });

  it('亮着时又换一次，从头计时，只熄一次', () => {
    const { flag, changes } = setup();
    flag.update(4);
    flag.update(5);
    vi.advanceTimersByTime(200);
    flag.update(6);
    vi.advanceTimersByTime(200);
    expect(flag.reflowing).toBe(true);
    vi.advanceTimersByTime(200);
    expect(changes).toEqual([true, false]);
  });

  it('减弱动效时从不亮', () => {
    const { flag, changes } = setup(true);
    flag.update(4);
    flag.update(5);
    expect(changes).toEqual([]);
  });

  it('列数是被侧边栏挤变的时候不亮，照样记下新的列数', () => {
    vi.useFakeTimers();
    let held = true;
    const changes: boolean[] = [];
    const flag = createReflowFlag({
      reduced: () => false,
      held: () => held,
      onChange: (on) => changes.push(on),
    });
    flag.update(4);
    flag.update(6);
    expect(changes).toEqual([]);
    held = false;
    flag.update(6);
    expect(changes).toEqual([]);
    flag.update(5);
    expect(changes).toEqual([true]);
  });

  it('释放后排着的熄灭不再来', () => {
    const { flag, changes } = setup();
    flag.update(4);
    flag.update(5);
    flag.dispose();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true]);
  });
});
