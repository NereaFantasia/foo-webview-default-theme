import { describe, expect, it } from 'vitest';
import {
  createJumpCounter,
  NATURAL_END_SECONDS,
  type JumpSample,
} from '../../../../src/immersive/spectrum/usePlaybackJumps.ts';

/** 按宿主推进度的节奏喂：每拍比上一拍晚 100 ms，只改给出的几项。 */
function drive(start: JumpSample) {
  const counter = createJumpCounter();
  let now = 0;
  let current = start;
  counter.sample(current, now);
  return {
    counter,
    feed(change: Partial<JumpSample>): void {
      now += 100;
      current = { ...current, ...change };
      counter.sample(current, now);
    },
  };
}

const START: JumpSample = { position: 10, duration: 200, playing: true, track: 'a|0' };

describe('createJumpCounter', () => {
  it('正常走的进度、暂停与继续都不算断点', () => {
    const { counter, feed } = drive(START);
    feed({ position: 10.1 });
    feed({ playing: false });
    feed({ playing: true });
    expect(counter.count()).toStrictEqual(0);
  });

  it('同一首里跳了算一次', () => {
    const { counter, feed } = drive(START);
    feed({ position: 120 });
    expect(counter.count()).toStrictEqual(1);
    feed({ position: 20 });
    expect(counter.count()).toStrictEqual(2);
  });

  it('中途换曲算；上一首停在末尾以内自然接到下一首不算；时长未知的换曲都算', () => {
    const { counter, feed } = drive(START);
    feed({ track: 'b|0', position: 0, duration: 180 });
    expect(counter.count()).toStrictEqual(1);
    feed({ position: 180 - NATURAL_END_SECONDS / 2 });
    const beforeEnd = counter.count();
    feed({ track: 'c|0', position: 0, duration: 240 });
    expect(counter.count()).toStrictEqual(beforeEnd);
    feed({ track: 'stream', duration: 0 });
    feed({ position: 3600.1 });
    const streaming = counter.count();
    feed({ track: 'd|0', position: 0 });
    expect(counter.count()).toStrictEqual(streaming + 1);
  });

  it('同一拍晚些再喂一次不算新的一拍，外推的锚点不被拨回', () => {
    const counter = createJumpCounter();
    counter.sample(START, 0);
    // 再喂一次若重设锚点，700 ms 时的外推值只有 10.1 s，10.7 s 会被当成跳变。
    counter.sample(START, 600);
    counter.sample({ ...START, position: 10.7 }, 700);
    expect(counter.count()).toStrictEqual(0);
  });

  it('每个断点通知一次，退订之后不再通知', () => {
    const counter = createJumpCounter();
    const seen: number[] = [];
    const off = counter.subscribe(() => seen.push(counter.count()));
    counter.sample(START, 0);
    counter.sample({ ...START, position: 120 }, 100);
    off();
    counter.sample({ ...START, position: 20 }, 200);
    expect(seen).toStrictEqual([1]);
    expect(counter.count()).toStrictEqual(2);
  });
});
