import { expect, it } from 'vitest';
import { shuffled } from '../../../src/kit/shuffle.ts';

it('洗牌返回一份排列，保留全部成员及重复值，不修改原数组', () => {
  const original = Object.freeze([1, 2, 3, 4]);
  expect(shuffled(original, () => 0)).toEqual([2, 3, 4, 1]);
  expect(original).toEqual([1, 2, 3, 4]);
  expect(shuffled([1, 1, 2, 3], () => 0.999).sort()).toEqual([1, 1, 2, 3]);
  expect(shuffled([], () => 0)).toEqual([]);
  expect(shuffled([1], () => 0)).toEqual([1]);
});
