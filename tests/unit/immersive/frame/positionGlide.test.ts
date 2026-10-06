import { expect, test } from 'vitest';
import type { Motion } from '../../../../src/immersive/frame/canvasMotion.ts';
import {
  EXTRAPOLATE_MS,
  JUMP_SECONDS,
  createPositionGlide,
} from '../../../../src/immersive/frame/positionGlide.ts';

const GLIDE: Motion = { duration: 200, ease: (progress) => progress };
const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThan(1e-9);

test('播放中按墙钟外推，最多推 EXTRAPOLATE_MS；暂停时停在宿主给的位置', () => {
  const clock = createPositionGlide();
  expect(clock.sample({ seconds: 10, live: true }, 'a', 0, GLIDE)).toBeNull();
  close(clock.at(100), 10.1);
  close(clock.at(10_000), 10 + EXTRAPOLATE_MS / 1000);
  clock.sample({ seconds: 10.2, live: false }, 'a', 200, GLIDE);
  close(clock.at(900), 10.2);
});

test('正常的一拍不算跳变，也不滑', () => {
  const clock = createPositionGlide();
  clock.sample({ seconds: 10, live: true }, 'a', 0, GLIDE);
  expect(clock.sample({ seconds: 10.14, live: true }, 'a', 100, GLIDE)).toBeNull();
  expect(clock.gliding(100)).toBe(false);
  close(clock.at(150), 10.19);
});

test('同一首里跳了：从屏幕上此刻的位置滑向新位置，途中目标照常往前走，到时长末正好追上', () => {
  const clock = createPositionGlide();
  clock.sample({ seconds: 10, live: true }, 'a', 0, GLIDE);
  expect(clock.sample({ seconds: 70, live: true }, 'a', 100, GLIDE)).toBe('jump');
  expect(clock.gliding(100)).toBe(true);
  close(clock.at(100), 10.1);
  // 走到一半：起点 10.1，目标此刻是 70.1。
  close(clock.at(200), 10.1 + (70.1 - 10.1) * 0.5);
  close(clock.at(300), 70.2);
  expect(clock.gliding(300)).toBe(false);
});

test('滑的途中又跳：从当时的位置重新滑；不给过渡时直接落到新位置', () => {
  const clock = createPositionGlide();
  clock.sample({ seconds: 0, live: false }, 'a', 0, GLIDE);
  clock.sample({ seconds: 100, live: false }, 'a', 0, GLIDE);
  const midway = clock.at(100);
  close(midway, 50);
  clock.sample({ seconds: 20, live: false }, 'a', 100, GLIDE);
  close(clock.at(100), 50);
  close(clock.at(200), 35);
  const direct = createPositionGlide();
  direct.sample({ seconds: 0, live: false }, 'a', 0);
  expect(direct.sample({ seconds: 100, live: false }, 'a', 0, null)).toBe('jump');
  close(direct.at(0), 100);
});

test('不给过渡的跳变不打断正在滑的那一段：途中改追新目标', () => {
  const clock = createPositionGlide();
  clock.sample({ seconds: 0, live: false }, 'a', 0, GLIDE);
  clock.sample({ seconds: 100, live: false }, 'a', 0, GLIDE);
  clock.sample({ seconds: 200, live: false }, 'a', 100, null);
  expect(clock.gliding(100)).toBe(true);
  close(clock.at(100), 100);
  close(clock.at(200), 200);
});

test('换曲不滑，返回 track；第一拍什么都不算', () => {
  const clock = createPositionGlide();
  expect(clock.sample({ seconds: 200, live: true }, 'a', 0, GLIDE)).toBeNull();
  expect(clock.sample({ seconds: 0, live: true }, 'b', 100, GLIDE)).toBe('track');
  expect(clock.gliding(100)).toBe(false);
  close(clock.at(100), 0);
});

test('给了周期就取短的那头滑，滑完落在目标上', () => {
  const clock = createPositionGlide(120);
  clock.sample({ seconds: 110, live: false }, 'a', 0, GLIDE);
  clock.sample({ seconds: 10, live: false }, 'a', 0, GLIDE);
  // 往前 20 s 比往回 100 s 近：一半时在 120，即下一圈的 0。
  close(clock.at(100), 120);
  close(clock.at(200), 10);
  expect(JUMP_SECONDS).toBeLessThan(1);
});
