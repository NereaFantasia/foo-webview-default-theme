import { describe, expect, it } from 'vitest';
import { createSeekMotion, type SeekMotionInput } from '../../../../src/shell/player/seekMotion.ts';

function setup() {
  let time = 0;
  let next = 0;
  const frames = new Map<number, () => void>();
  const painted: number[] = [];
  const motion = createSeekMotion(
    {
      now: () => time,
      request(callback) {
        const handle = ++next;
        frames.set(handle, callback);
        return handle;
      },
      cancel: (handle) => {
        frames.delete(handle);
      },
    },
    (fraction) => painted.push(fraction),
  );
  let input: SeekMotionInput = {
    generation: 1,
    fraction: 0.4,
    present: true,
    visible: true,
    reduced: false,
    intent: null,
  };
  const update = (patch: Partial<SeekMotionInput> = {}) => {
    input = { ...input, ...patch };
    motion.update(input);
  };
  const at = (ms: number) => {
    time = ms;
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback();
  };
  update();
  return { update, at, frames, painted, shown: () => painted.at(-1), motion };
}

describe('进度位置缓动', () => {
  it('首次显示与普通进度回读直接到位，不产生多余帧', () => {
    const env = setup();
    expect(env.shown()).toBe(0.4);
    env.update({ fraction: 0.41 });
    expect(env.shown()).toBe(0.41);
    expect(env.frames.size).toBe(0);
  });

  it.each(['click', 'key', 'return'] as const)('%s 从现有画面缓动到目标', (kind) => {
    const env = setup();
    env.update({ fraction: 0.8, intent: { sequence: 1, kind } });
    expect(env.shown()).toBe(0.4);
    env.at(80);
    expect(env.shown()).toBeGreaterThan(0.4);
    expect(env.shown()).toBeLessThan(0.8);
    env.at(167);
    expect(env.shown()).toBe(0.8);
    expect(env.frames.size).toBe(0);
  });

  it('Home 使用250ms归零，连续改向接着当前画面走', () => {
    const env = setup();
    env.update({ fraction: 0, intent: { sequence: 1, kind: 'home' } });
    env.at(100);
    const before = env.shown();
    env.update({ fraction: 0.7, intent: { sequence: 2, kind: 'key' } });
    expect(env.shown()).toBe(before);
    env.at(267);
    expect(env.shown()).toBe(0.7);
    env.update({ fraction: 0, intent: { sequence: 3, kind: 'home' } });
    env.at(467);
    expect(env.shown()).toBeGreaterThan(0);
    env.at(517);
    expect(env.shown()).toBe(0);
  });

  it('动画中反向只走剩余距离，旧帧不把新位置拉回去', () => {
    const env = setup();
    env.update({ fraction: 0.9, intent: { sequence: 1, kind: 'key' } });
    const oldFrame = [...env.frames.values()][0];
    env.at(80);
    const shown = env.shown() ?? 0;
    env.update({ fraction: shown - 0.02, intent: { sequence: 2, kind: 'key' } });
    oldFrame?.();
    expect(env.shown()).toBe(shown);
    env.at(100);
    expect(env.shown()).toBeCloseTo(shown - 0.02);
    expect(env.frames.size).toBe(0);
  });

  it('拖动立即接管尚未完成的点击或归零，取消再缓动回实际进度', () => {
    const env = setup();
    env.update({ generation: 2, fraction: 0 });
    env.at(60);
    env.update({ fraction: 0.75, intent: { sequence: 1, kind: 'drag' } });
    expect(env.shown()).toBe(0.75);
    expect(env.frames.size).toBe(0);
    env.update({ fraction: 0.05, intent: { sequence: 2, kind: 'return' } });
    env.at(227);
    expect(env.shown()).toBeCloseTo(0.05);
  });

  it('新播放轮次从旧显示比例归零，再接入新曲最新进度', () => {
    const env = setup();
    env.update({ generation: 2, fraction: 0 });
    env.at(100);
    expect(env.shown()).toBeGreaterThan(0);
    expect(env.shown()).toBeLessThan(0.4);
    env.update({ fraction: 0.02 });
    env.at(228);
    expect(env.shown()).toBeCloseTo(0.2);
    env.at(500);
    expect(env.shown()).toBeCloseTo(0.046105);
    env.at(650);
    expect(env.shown()).toBeCloseTo(0.005755);
    env.at(728);
    expect(env.shown()).toBe(0);
    env.update({ fraction: 0.03 });
    env.at(895);
    expect(env.shown()).toBeCloseTo(0.03);
    expect(env.frames.size).toBe(0);
  });

  it('同曲重播照样归零，普通元数据与位置更新不重启归零', () => {
    const env = setup();
    env.update({ generation: 2, fraction: 0 });
    env.at(100);
    const middle = env.shown();
    env.update({ generation: 2, fraction: 0 });
    expect(env.shown()).toBe(middle);
    env.at(728);
    expect(env.shown()).toBe(0);
    expect(env.frames.size).toBe(0);
  });

  it('连续切歌从当前显示位置收回，每个新轮次保留完整的收回时长', () => {
    const env = setup();
    env.update({ generation: 2, fraction: 0 });
    env.at(228);
    expect(env.shown()).toBeCloseTo(0.2);
    env.update({ generation: 3, fraction: 0 });
    expect(env.shown()).toBeCloseTo(0.2);
    env.at(456);
    expect(env.shown()).toBeCloseTo(0.1);
    env.at(956);
    expect(env.shown()).toBe(0);
    expect(env.frames.size).toBe(0);
  });

  it.each(['reduced', 'hidden', 'absent'] as const)('%s 立即落到终值并停止逐帧工作', (state) => {
    const env = setup();
    env.update({ fraction: 0.8, intent: { sequence: 1, kind: 'key' } });
    env.at(50);
    env.update({
      reduced: state === 'reduced',
      visible: state !== 'hidden',
      present: state !== 'absent',
    });
    expect(env.shown()).toBe(0.8);
    expect(env.frames.size).toBe(0);
    env.update({ reduced: false, visible: true, present: true, fraction: 0.9 });
    expect(env.shown()).toBe(0.9);
  });

  it('释放后旧帧无效，重新挂载只显示当前值', () => {
    const env = setup();
    env.update({ fraction: 0.8, intent: { sequence: 1, kind: 'key' } });
    const stale = [...env.frames.values()][0];
    env.motion.dispose();
    const count = env.painted.length;
    stale?.();
    expect(env.painted).toHaveLength(count);
    env.update({ fraction: 0.2 });
    expect(env.shown()).toBe(0.2);
    expect(env.frames.size).toBe(0);
  });
});
