import { describe, expect, it } from 'vitest';
import {
  CARRY,
  MAX_GLIDE_MS,
  OMEGA,
  glideAt,
  glideDone,
  glideVelocity,
  startGlide,
} from '../../../../src/immersive/coverflow/glide.ts';

describe('startGlide：临界阻尼弹簧', () => {
  it('走一步约 0.65 s 到站，其中走过 90% 约 300 ms', () => {
    const glide = startGlide(3, 4, 0);
    expect(glide.duration).toBeGreaterThan(500);
    expect(glide.duration).toBeLessThan(800);
    expect(glideAt(glide, 300)).toBeGreaterThan(3.88);
    expect(glideAt(glide, 300)).toBeLessThan(3.92);
  });

  it('角频率 13、中途改目标保留 60% 的速度', () => {
    expect(OMEGA).toBe(13);
    expect(CARRY).toBe(0.6);
  });

  it('距离不同用的时间差不多，远了也只多一点点：回位不会因为远而慢很多', () => {
    const one = startGlide(0, 1, 0).duration;
    const nine = startGlide(0, 9, 0).duration;
    expect(nine).toBeGreaterThan(one);
    expect(nine - one).toBeLessThan(400);
  });

  it('往回走与往前走一样', () => {
    expect(startGlide(4, 3, 0).duration).toBe(startGlide(3, 4, 0).duration);
  });

  it('已经在终点且静止：不用走', () => {
    expect(startGlide(5, 5, 0).duration).toBe(0);
  });

  it('时间有上限', () => {
    expect(startGlide(0, 1, 0, -1e15).duration).toBe(MAX_GLIDE_MS);
  });
});

describe('glideAt：补间的值', () => {
  it('起点是 from，到站后停在 to', () => {
    const glide = startGlide(2, 3, 1000);
    expect(glideAt(glide, 1000)).toBe(2);
    expect(glideAt(glide, 1000 + glide.duration)).toBe(3);
    expect(glideAt(glide, 9000)).toBe(3);
  });

  it('起点之前也不超出 from', () => {
    expect(glideAt(startGlide(2, 3, 1000), 900)).toBe(2);
  });

  it('从静止出发：单调、不越过终点、起步是缓缓加速', () => {
    const glide = startGlide(0, 1, 0);
    let last = 0;
    for (let t = 10; t < glide.duration; t += 10) {
      const value = glideAt(glide, t);
      expect(value).toBeGreaterThanOrEqual(last);
      expect(value).toBeLessThanOrEqual(1);
      last = value;
    }
    // 起步慢：头 20 ms 走得比后面同样长的一段少
    expect(glideAt(glide, 20)).toBeLessThan(glideAt(glide, 120) - glideAt(glide, 100));
  });

  it('向后补间时值递减', () => {
    const glide = startGlide(5, 4, 0);
    expect(glideAt(glide, 100)).toBeLessThan(5);
    expect(glideAt(glide, 100)).toBeGreaterThan(4);
  });

  it('50% 约 130 ms，与角频率对得上', () => {
    const glide = startGlide(0, 1, 0);
    // 临界阻尼：x(t) = 1 − (1 + ωt)e^(−ωt)，ωt = 1.678 时是 50%
    expect(glideAt(glide, (1.678 / OMEGA) * 1000)).toBeCloseTo(0.5, 2);
  });
});

describe('glideVelocity：速度', () => {
  it('从静止出发起点速度是 0，到站后是 0', () => {
    const glide = startGlide(0, 1, 0);
    expect(glideVelocity(glide, 0)).toBeCloseTo(0, 10);
    expect(glideVelocity(glide, glide.duration)).toBe(0);
  });

  it('朝终点走时速度同号，向后补间反号', () => {
    expect(glideVelocity(startGlide(0, 1, 0), 100)).toBeGreaterThan(0);
    expect(glideVelocity(startGlide(1, 0, 0), 100)).toBeLessThan(0);
  });

  it('速度是位置的导数', () => {
    const glide = startGlide(0, 1, 0);
    const step = 0.5;
    const numeric = ((glideAt(glide, 200 + step) - glideAt(glide, 200 - step)) / (2 * step)) * 1000;
    expect(glideVelocity(glide, 200)).toBeCloseTo(numeric, 3);
  });
});

describe('中途改目标：带着速度接着走', () => {
  it('新一段的起点就是改目标那一刻的位置，位置不跳', () => {
    const first = startGlide(0, 1, 0);
    const at = glideAt(first, 100);
    const second = startGlide(at, 2, 100, glideVelocity(first, 100));
    expect(glideAt(second, 100)).toBeCloseTo(at, 10);
    expect(glideAt(second, 100 + second.duration)).toBe(2);
  });

  it('新一段的起点速度就是改目标那一刻的速度，速度不跳', () => {
    const first = startGlide(0, 1, 0);
    const speed = glideVelocity(first, 100);
    const second = startGlide(glideAt(first, 100), 2, 100, speed);
    expect(glideVelocity(second, 100)).toBeCloseTo(speed, 10);
  });

  it('带着速度比从静止重起走得远', () => {
    const first = startGlide(0, 1, 0);
    const at = glideAt(first, 100);
    const withSpeed = startGlide(at, 2, 100, glideVelocity(first, 100));
    const fromRest = startGlide(at, 2, 100);
    expect(glideAt(withSpeed, 200)).toBeGreaterThan(glideAt(fromRest, 200));
  });

  it('朝终点的初速度太大时压住，不会冲过终点再折回来', () => {
    const glide = startGlide(0, 1, 0, 1000);
    for (let t = 0; t < glide.duration; t += 8) {
      expect(glideAt(glide, t)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('背离终点的初速度保留：先继续滑一小段再掉头', () => {
    const glide = startGlide(2, 3, 0, -2);
    expect(glideAt(glide, 10)).toBeLessThan(2);
    expect(glideAt(glide, glide.duration)).toBe(3);
  });

  it('连按：目标累加，一次补间走完', () => {
    // 0 → 1 的补间走到 100 ms 时又按了一下 →，目标变成 2
    const first = startGlide(0, 1, 0);
    const second = startGlide(glideAt(first, 100), 2, 100, glideVelocity(first, 100));
    expect(second.to).toBe(2);
    expect(second.from).toBeGreaterThan(0);
    expect(second.from).toBeLessThan(1);
    expect(glideDone(second, 100 + second.duration)).toBe(true);
  });
});

describe('glideDone', () => {
  it('到时为止', () => {
    const glide = startGlide(0, 1, 0);
    expect(glideDone(glide, glide.duration - 1)).toBe(false);
    expect(glideDone(glide, glide.duration)).toBe(true);
  });
});
