import { expect, test } from 'vitest';
import { channelDr, createDrMeter } from '../../../../src/immersive/gauges/drMeter.ts';

const RATE = 8000;

function sine(seconds: number, amplitude: number): Float32Array {
  const frames = Math.round(RATE * seconds);
  const out = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * 440 * index) / RATE);
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function drOf(planes: Float32Array[]): number | null {
  const meter = createDrMeter(RATE, planes.length);
  meter.push(planes);
  return meter.finish();
}

test('满幅正弦是 DR0：块 RMS 带 √2，正弦的 RMS 与峰值同为 0 dB', () => {
  const signal = sine(30, 1);
  expect(drOf([signal, signal])).toBe(0);
});

test('响段加安静段：取最响 20% 块的 RMS 与第二大峰值，与手算一致', () => {
  // 十块：两块 0.5 的正弦（最响的 20%），八块 0.1 的正弦里夹一个 0.9 的尖峰（第二大峰值在安静段里）。
  const loud = sine(6, 0.5);
  const quiet = sine(24, 0.1);
  quiet[RATE * 4] = 0.9;
  quiet[RATE * 10] = 0.95;
  const signal = concat([loud, quiet]);
  const expected = Math.round(20 * Math.log10(0.9 / 0.5));
  expect(drOf([signal])).toBe(expected);
});

test('各声道平均后取整', () => {
  const left = sine(30, 1);
  const right = concat([sine(6, 0.25), sine(24, 0.05)]);
  right[RATE * 20] = 1;
  right[RATE * 25] = 1;
  const rightDr = 20 * Math.log10(1 / 0.25);
  expect(drOf([left, right])).toBe(Math.round((0 + rightDr) / 2));
});

test('末块不满照算；不满三块不给值；分段喂与一次喂相同', () => {
  expect(drOf([sine(5.9, 0.5)])).toBe(null);
  expect(drOf([sine(6.5, 0.5)])).not.toBe(null);

  const signal = concat([sine(10, 0.8), sine(17, 0.2)]);
  signal[RATE * 12] = 0.99;
  const whole = drOf([signal]);
  const meter = createDrMeter(RATE, 1);
  for (let at = 0; at < signal.length; at += 7777) {
    meter.push([signal], at, Math.min(signal.length, at + 7777));
  }
  expect(meter.finish()).toBe(whole);
});

test('整路静音按 0 计', () => {
  expect(channelDr([0, 0, 0], [0, 0, 0])).toBe(0);
});
