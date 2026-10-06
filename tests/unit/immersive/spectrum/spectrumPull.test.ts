import { expect, test } from 'vitest';
import {
  IDLE_PULL_MS,
  frameKeyOf,
  startSpectrumPull,
  type SpectrumAnswer,
} from '../../../../src/immersive/spectrum/spectrumPull.ts';
import { spectrumAnswer, spectrumFailure } from '../../../fixtures/audioAnswers.ts';
import { fakeFrames, flush, FRAME_MS } from '../../../fixtures/fakeFrames.ts';

/**
 * 拉取循环用手动帧时钟与假的 `fetch` 测：`fetch` 答替身此刻的应答，`frames.step()` 走一拍。
 */
function start(intervalMs = FRAME_MS) {
  const frames = fakeFrames();
  let answer: SpectrumAnswer = spectrumFailure('No spectrum data available');
  let streamTime = 0;
  let holding = false;
  let failing = false;
  const held: (() => void)[] = [];
  const delivered: SpectrumAnswer[] = [];
  let fetched = 0;
  const pull = startSpectrumPull({
    fetch: async () => {
      fetched += 1;
      const current = answer;
      if (holding) await new Promise<void>((resolve) => held.push(resolve));
      if (failing) throw new Error('bridge failed');
      return current;
    },
    intervalMs,
    onFrame: (frame) => delivered.push(frame),
    clock: frames.clock,
  });
  return {
    pull,
    frames,
    delivered,
    fetched: () => fetched,
    play() {
      streamTime += FRAME_MS / 1000;
      answer = spectrumAnswer({ streamTime, spectrum: [streamTime] });
    },
    pause() {
      answer = spectrumAnswer({ state: 'paused', streamTime, spectrum: [0] });
    },
    answerWith(next: SpectrumAnswer) {
      answer = next;
    },
    fail(value: boolean) {
      failing = value;
    },
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      held.splice(0).forEach((resolve) => resolve());
    },
  };
}

test('frameKeyOf 取状态加 streamTime；没有 streamTime 给 null', () => {
  expect(frameKeyOf({ state: 'playing', streamTime: 1.5 })).toBe('playing|1.5');
  expect(frameKeyOf({ streamTime: 2 })).toBe('|2');
  expect(frameKeyOf({ state: 'paused' })).toBeNull();
  expect(frameKeyOf({ streamTime: '1' })).toBeNull();
  expect(frameKeyOf(null)).toBeNull();
});

test('每拍问一次，只交新帧：同一帧拉到三次只交一次', async () => {
  const host = start();
  host.play();
  await host.frames.step();
  await host.frames.step();
  await host.frames.step();
  expect(host.fetched()).toBe(3);
  expect(host.delivered).toHaveLength(1);
  host.play();
  await host.frames.step();
  expect(host.delivered).toHaveLength(2);
});

test('前一次还没回就跳过这一拍；回来之后下一拍接着拉', async () => {
  const host = start();
  host.hold();
  host.play();
  await host.frames.step();
  await host.frames.step();
  await host.frames.step();
  expect(host.fetched()).toBe(1);
  host.release();
  await flush();
  expect(host.delivered).toHaveLength(1);
  host.play();
  await host.frames.step();
  expect(host.fetched()).toBe(2);
  expect(host.delivered).toHaveLength(2);
});

test('应答失败或调用出错后，不满 IDLE_PULL_MS 不再拉', async () => {
  const host = start();
  await host.frames.step();
  expect(host.fetched()).toBe(1);
  await host.frames.stepWithin(IDLE_PULL_MS);
  expect(host.fetched()).toBe(1);
  await host.frames.step();
  expect(host.fetched()).toBe(2);

  host.fail(true);
  await host.frames.stepWithin(IDLE_PULL_MS);
  await host.frames.step();
  expect(host.fetched()).toBe(3);
  await host.frames.stepWithin(IDLE_PULL_MS);
  expect(host.fetched()).toBe(3);
  expect(host.delivered).toHaveLength(0);
});

test('调用出错之后恢复：过了 IDLE_PULL_MS 照常拉，新帧照交', async () => {
  const host = start();
  host.fail(true);
  host.play();
  await host.frames.step();
  expect(host.delivered).toHaveLength(0);
  host.fail(false);
  await host.frames.stepWithin(IDLE_PULL_MS);
  await host.frames.step();
  expect(host.fetched()).toBe(2);
  expect(host.delivered).toHaveLength(1);
  host.play();
  await host.frames.step();
  expect(host.fetched()).toBe(3);
  expect(host.delivered).toHaveLength(2);
});

test('暂停：静音帧只交一次，之后隔 IDLE_PULL_MS 才拉；恢复播放后回到每拍拉', async () => {
  const host = start();
  host.play();
  await host.frames.step();
  host.pause();
  await host.frames.step();
  expect(host.delivered).toHaveLength(2);
  const paused = host.delivered[1];
  expect(paused?.success === true ? paused.state : null).toBe('paused');
  const pulled = host.fetched();
  await host.frames.stepWithin(IDLE_PULL_MS);
  expect(host.fetched()).toBe(pulled);
  await host.frames.step();
  expect(host.fetched()).toBe(pulled + 1);
  expect(host.delivered, '同一个静音帧不再交').toHaveLength(2);
  host.play();
  await host.frames.stepWithin(IDLE_PULL_MS);
  await host.frames.step();
  expect(host.delivered).toHaveLength(3);
  const resumed = host.fetched();
  host.play();
  await host.frames.step();
  expect(host.fetched()).toBe(resumed + 1);
  expect(host.delivered).toHaveLength(4);
});

test('停止帧同暂停：只交一次，之后隔 IDLE_PULL_MS 才拉', async () => {
  const host = start();
  host.play();
  await host.frames.step();
  host.answerWith(spectrumAnswer({ state: 'stopped', streamTime: 1, spectrum: [0] }));
  await host.frames.step();
  const pulled = host.fetched();
  await host.frames.stepWithin(IDLE_PULL_MS);
  expect(host.fetched()).toBe(pulled);
  await host.frames.step();
  expect(host.fetched()).toBe(pulled + 1);
  expect(host.delivered).toHaveLength(2);
});

test('订阅不存在（NOT_FOUND）：停拉，不再排帧', async () => {
  const host = start();
  host.play();
  await host.frames.step();
  host.answerWith(spectrumFailure('subscription not found', 'NOT_FOUND'));
  await host.frames.step();
  const pulled = host.fetched();
  for (let index = 0; index < 20; index += 1) await host.frames.step();
  expect(host.fetched()).toBe(pulled);
  expect(host.frames.pending()).toBe(0);
});

test('间隔长于一拍（15 fps）：每 4 拍才拉一次', async () => {
  const host = start(1000 / 15);
  for (let index = 0; index < 20; index += 1) {
    host.play();
    await host.frames.step();
  }
  expect(host.fetched()).toBe(5);
});

test('stop 之后不再拉，在途的应答回来也不交', async () => {
  const host = start();
  host.hold();
  host.play();
  await host.frames.step();
  host.pull.stop();
  host.release();
  await flush();
  expect(host.delivered).toHaveLength(0);
  expect(host.frames.pending()).toBe(0);
  await host.frames.step();
  expect(host.fetched()).toBe(1);
});
