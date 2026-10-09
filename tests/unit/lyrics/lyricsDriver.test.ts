import { describe, expect, it } from 'vitest';
import {
  startLyricsDriver,
  type FrameSource,
  type LyricsClockFace,
  type LyricsPlayerFace,
} from '../../../src/lyrics/lyricsDriver.ts';

type Change = Parameters<Parameters<LyricsClockFace['onChange']>[0]>[0];

interface FakeClock extends LyricsClockFace {
  state: LyricsClockFace['state'];
  /** 时钟此刻答的位置，秒。 */
  at: number;
}

/** 时钟按测试给的位置答；帧由测试一帧一帧推。 */
function setup() {
  const calls: string[] = [];
  const player: LyricsPlayerFace = {
    setCurrentTime: (time, isSeek) => calls.push(`time ${time}${isSeek ? ' seek' : ''}`),
    update: (delta) => calls.push(`update ${delta}`),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  };
  const listeners = new Set<(change: Change) => void>();
  const clock: FakeClock = {
    state: 'playing',
    at: 0,
    position() {
      return this.at;
    },
    onChange(listener: (change: Change) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const pending = new Map<number, (now: number) => void>();
  let next = 1;
  const frames: FrameSource = {
    request: (callback) => {
      pending.set(next, callback);
      return next++;
    },
    cancel: (handle) => pending.delete(handle),
  };
  const driver = startLyricsDriver(player, clock, frames);
  return {
    calls,
    clock,
    driver,
    pending: () => pending.size,
    tick(now: number) {
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback(now);
    },
    change(change: Change) {
      for (const listener of listeners) listener(change);
    },
  };
}

describe('startLyricsDriver', () => {
  it('看得见时先跳到当前位置，之后每帧推时间再 update，时间换成毫秒', () => {
    const env = setup();
    env.clock.at = 12;
    env.driver.setActive(true);
    expect(env.calls.splice(0)).toStrictEqual(['time 12000 seek', 'resume']);
    env.tick(100);
    env.clock.at = 12.5;
    env.tick(116);
    expect(env.calls).toStrictEqual(['time 12000', 'update 0', 'time 12500', 'update 16']);
  });

  it('正偏移延后显示，隐藏后再显示仍使用校正时间', () => {
    const env = setup();
    env.clock.at = 12;
    env.driver.setOffset(1.5);
    env.driver.setActive(true);
    expect(env.calls.splice(0)).toEqual(['time 10500 seek', 'resume']);
    env.driver.setOffset(-0.5);
    expect(env.calls.splice(0)).toEqual(['time 12500 seek']);
    env.driver.setActive(false);
    env.calls.splice(0);
    env.clock.at = 20;
    env.driver.setActive(true);
    expect(env.calls[0]).toBe('time 20500 seek');
    env.driver.dispose();
  });

  it('看不见时停帧并暂停，时钟变化也不再推', () => {
    const env = setup();
    env.driver.setActive(true);
    env.calls.splice(0);
    env.driver.setActive(false);
    expect(env.pending()).toBe(0);
    expect(env.calls.splice(0)).toStrictEqual(['pause']);
    env.change({ reason: 'seek', state: 'playing', position: 30 });
    expect(env.calls).toStrictEqual([]);
  });

  it('跳转与换曲当作跳转告诉播放器；暂停只改播放状态', () => {
    const env = setup();
    env.driver.setActive(true);
    env.calls.splice(0);
    env.change({ reason: 'seek', state: 'playing', position: 30 });
    env.clock.state = 'paused';
    env.change({ reason: 'state', state: 'paused', position: 30 });
    expect(env.calls).toStrictEqual(['time 30000 seek', 'resume', 'pause']);
  });

  it('释放后不再响应，重复释放无害', () => {
    const env = setup();
    env.driver.setActive(true);
    env.driver.dispose();
    env.driver.dispose();
    env.calls.splice(0);
    env.driver.setActive(true);
    env.change({ reason: 'track', state: 'playing', position: 0 });
    env.tick(10);
    expect(env.calls).toStrictEqual([]);
  });
});
