import { createStore } from 'jotai/vanilla';
import { expect, test } from 'vitest';
import {
  flowUnavailableAtom,
  markFlowUnavailable,
  washModeOf,
} from '../../../../src/immersive/wash/washMode.ts';

test('washModeOf：减弱动效或流动档已判不可用都走静态档，否则流动档', () => {
  expect(washModeOf(false, false)).toBe('flow');
  expect(washModeOf(true, false)).toBe('static');
  expect(washModeOf(false, true)).toBe('static');
  expect(washModeOf(true, true)).toBe('static');
});

test('washModeOf：设置页选了静态档就走静态档', () => {
  expect(washModeOf(false, false, true)).toBe('static');
  expect(washModeOf(false, false, false)).toBe('flow');
});

test('流动档判不可用之后这一次运行里一直是不可用，别的 store 不受影响', () => {
  const store = createStore();
  const other = createStore();
  expect(store.get(flowUnavailableAtom)).toBe(false);
  markFlowUnavailable(store);
  markFlowUnavailable(store);
  expect(store.get(flowUnavailableAtom)).toBe(true);
  expect(other.get(flowUnavailableAtom)).toBe(false);
});
