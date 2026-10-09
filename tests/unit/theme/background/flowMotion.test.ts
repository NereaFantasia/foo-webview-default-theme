import { expect, test } from 'vitest';
import {
  advanceFlowMotion,
  createFlowMotion,
  setFlowPaused,
} from '../../../../src/theme/background/flowMotion.ts';
import { DURATION_MS } from '../../../../src/motion/timing.ts';

test('60 fps 与 30 fps 绘制推进同一配方，起点保留初始旋转', () => {
  const fast = createFlowMotion(),
    slow = createFlowMotion();
  expect(fast.rotation).toBe(1);
  for (let i = 0; i < 60; i++) advanceFlowMotion(fast, 1000 / 60);
  for (let i = 0; i < 30; i++) advanceFlowMotion(slow, 1000 / 30);
  expect(fast).toEqual(slow);
  expect(fast.time).toBeCloseTo(1.248);
  expect(fast.gradient).toBeCloseTo(0.156);
  expect(fast.rotation).toBeCloseTo(1.078, 3);
});

test('长帧不补算休眠时间，旋转边界会反向', () => {
  const state = createFlowMotion();
  advanceFlowMotion(state, 60_000);
  expect(state.time).toBeLessThanOrEqual(0.096 * 1.3);
  state.rotation = Math.PI * 2 + 0.0005;
  const before = state.rotation;
  advanceFlowMotion(state, 1000 / 60);
  expect(state.direction).toBe(-1);
  expect(state.rotation).toBeLessThan(before);
});

test('暂停速度线性下降，位移按速度积分，过渡结束后保持8%', () => {
  const state = createFlowMotion();
  setFlowPaused(state, true);
  expect(state.speed).toBe(1);
  for (let i = 1; i <= 3; i++) {
    advanceFlowMotion(state, 100);
    expect(state.speed).toBeCloseTo(1 - (0.92 * i * 100) / DURATION_MS.slow);
  }
  advanceFlowMotion(state, DURATION_MS.slow - 300);
  expect(state.speed).toBe(0.08);
  const simulated = (state.time / 0.016) * (1000 / 60) + state.remainder;
  expect(simulated).toBeCloseTo((DURATION_MS.slow * (1 + 0.08) * 1.3) / 2);
  advanceFlowMotion(state, 100);
  const after = (state.time / 0.016) * (1000 / 60) + state.remainder;
  expect(after - simulated).toBeCloseTo(10.4);
});

test('减速中继续播放，从当前速度线性恢复；相同状态更新不重启过渡', () => {
  const state = createFlowMotion();
  setFlowPaused(state, true);
  advanceFlowMotion(state, 100);
  const current = state.speed;
  setFlowPaused(state, false);
  expect(state.speed).toBe(current);
  advanceFlowMotion(state, 100);
  expect(state.speed).toBeCloseTo(current + ((1 - current) * 100) / DURATION_MS.slow);
  setFlowPaused(state, false);
  expect(state.speedElapsed).toBe(100);
  advanceFlowMotion(state, 100);
  expect(state.speed).toBeCloseTo(current + ((1 - current) * 200) / DURATION_MS.slow);
});

test('不同绘制间隔的减速位移相同，静态恢复直接采用当前速度', () => {
  const dense = createFlowMotion(),
    sparse = createFlowMotion();
  setFlowPaused(dense, true);
  setFlowPaused(sparse, true);
  for (let i = 0; i < 40; i++) advanceFlowMotion(dense, 10);
  for (let i = 0; i < 4; i++) advanceFlowMotion(sparse, 100);
  expect(dense.time).toBeCloseTo(sparse.time);
  expect(dense.remainder).toBeCloseTo(sparse.remainder);
  const position = sparse.rotation;
  setFlowPaused(sparse, false, true);
  expect(sparse.speed).toBe(1);
  expect(sparse.rotation).toBe(position);
});
