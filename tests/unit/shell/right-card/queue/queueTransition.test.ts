import { describe, expect, it } from 'vitest';
import {
  consumedSince,
  planTransition,
  withoutPlayed,
} from '../../../../../src/shell/right-card/queue/queueTransition.ts';

describe('consumedSince', () => {
  it('此刻就是记下的那份：取走 0 首', () => {
    expect(consumedSince(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
  });

  it('队首又播掉了几首：答几首', () => {
    expect(consumedSince(['a', 'b', 'c'], ['c'])).toBe(2);
    expect(consumedSince(['a', 'b'], [])).toBe(2);
  });

  it('别处改过队列：对不上答 null', () => {
    expect(consumedSince(['a', 'b', 'c'], ['a', 'c'])).toBeNull();
    expect(consumedSince(['a'], ['a', 'x'])).toBeNull();
  });
});

describe('withoutPlayed', () => {
  it('每首只去掉一次，同一首排两次时留下另一份', () => {
    expect(withoutPlayed(['a', 'b', 'a', 'c'], ['a'])).toEqual(['b', 'a', 'c']);
  });
});

describe('planTransition', () => {
  it('补回被移除的：按目标位置分段插回，不动留下的', () => {
    const plan = planTransition(['a', 'd'], ['a', 'b', 'c', 'd', 'e']);
    expect(plan.remove).toEqual([]);
    expect(plan.order).toBeNull();
    expect(plan.inserts).toEqual([
      { position: 1, paths: ['b', 'c'] },
      { position: 4, paths: ['e'] },
    ]);
  });

  it('调回原来的顺序：只重排', () => {
    const plan = planTransition(['c', 'a', 'b'], ['a', 'b', 'c']);
    expect(plan.remove).toEqual([]);
    expect(plan.order).toEqual([1, 2, 0]);
    expect(plan.inserts).toEqual([]);
  });

  it('目标里没有的先移除，再按目标排留下的', () => {
    const plan = planTransition(['x', 'b', 'a'], ['a', 'b']);
    expect(plan.remove).toEqual([0]);
    expect(plan.order).toEqual([1, 0]);
  });

  it('同一首出现几次按次数配对', () => {
    const plan = planTransition(['a', 'a', 'b'], ['a', 'b']);
    expect(plan.remove).toEqual([1]);
    expect(plan.order).toBeNull();
  });

  it('清空之后整份补回：一段插在 0', () => {
    expect(planTransition([], ['a', 'b']).inserts).toEqual([{ position: 0, paths: ['a', 'b'] }]);
  });
});
