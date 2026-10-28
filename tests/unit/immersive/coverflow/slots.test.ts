import { describe, expect, it } from 'vitest';
import {
  RENDER_RADIUS,
  coverflowLayout,
  inViewRange,
  slotAt,
  visibleIndexes,
  visibleRange,
} from '../../../../src/immersive/coverflow/slots.ts';

describe('slotAt：整数槽', () => {
  // 位置量自画稿 30F，封面 320 时 ±1、±2、±3 的脸中心离中线 300、440、560 像素；边长与倾角比画稿小一档
  const TABLE = [
    { d: 0, offset: 0, size: 1, tilt: 0, opacity: 1, shade: 0 },
    { d: 1, offset: 0.9375, size: 0.62, tilt: -20, opacity: 0.95, shade: 0.48 },
    { d: 2, offset: 1.375, size: 0.44, tilt: -26, opacity: 0.8, shade: 0.53 },
    { d: 3, offset: 1.75, size: 0.31, tilt: -30, opacity: 0.6, shade: 0.58 },
  ];

  it.each(TABLE)('右边第 $d 槽取表里的值', ({ d, ...expected }) => {
    const pose = slotAt(d);
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      expect(pose[key]).toBeCloseTo(expected[key], 10);
    }
  });

  it.each(TABLE)('左边第 $d 槽是右边的镜像：位置与倾角反号，其余相同', ({ d }) => {
    const right = slotAt(d);
    const left = slotAt(-d);
    expect(left.offset).toBeCloseTo(-right.offset, 10);
    expect(left.tilt).toBeCloseTo(-right.tilt, 10);
    expect(left.size).toBe(right.size);
    expect(left.opacity).toBe(right.opacity);
    expect(left.shade).toBe(right.shade);
  });

  it('左边的卡转正角（外侧边近），右边的转负角', () => {
    expect(slotAt(-1).tilt).toBeGreaterThan(0);
    expect(slotAt(1).tilt).toBeLessThan(0);
  });

  it('远端槽不透明度为 0，超出渲染半径的按远端槽返回', () => {
    expect(slotAt(RENDER_RADIUS).opacity).toBe(0);
    expect(slotAt(RENDER_RADIUS + 5)).toEqual(slotAt(RENDER_RADIUS));
    expect(slotAt(-RENDER_RADIUS - 2)).toEqual(slotAt(-RENDER_RADIUS));
  });
});

describe('slotAt：槽间插值', () => {
  it('0 到 1 之间的中点是两槽的平均', () => {
    const pose = slotAt(0.5);
    expect(pose.size).toBeCloseTo(0.81, 10);
    expect(pose.offset).toBeCloseTo(0.46875, 10);
    expect(pose.tilt).toBeCloseTo(-10, 10);
    expect(pose.opacity).toBeCloseTo(0.975, 10);
    expect(pose.shade).toBeCloseTo(0.24, 10);
  });

  it('3 到 4 之间向远端槽淡出', () => {
    expect(slotAt(3.5).opacity).toBeCloseTo(0.3, 10);
    expect(slotAt(3.99).opacity).toBeCloseTo(0.006, 6);
  });

  it('从 0 扫到 4，位置单调增、边长与不透明度单调减，没有跳变', () => {
    let last = slotAt(0);
    for (let d = 0.05; d <= RENDER_RADIUS; d += 0.05) {
      const pose = slotAt(d);
      expect(pose.offset).toBeGreaterThan(last.offset);
      expect(pose.size).toBeLessThan(last.size);
      expect(pose.opacity).toBeLessThanOrEqual(last.opacity);
      // 相邻两步的位置差不超过最大槽距（0.9375 每 1 个单位）的一小段，没有瞬移
      expect(pose.offset - last.offset).toBeLessThanOrEqual(0.05 * 0.9375 + 1e-9);
      last = pose;
    }
  });

  it('越过 0 时位置与倾角连续地换边', () => {
    const before = slotAt(-0.001);
    const after = slotAt(0.001);
    expect(before.offset).toBeLessThan(0);
    expect(after.offset).toBeGreaterThan(0);
    expect(Math.abs(after.offset - before.offset)).toBeLessThan(0.01);
    expect(Math.abs(after.tilt - before.tilt)).toBeLessThan(0.1);
  });
});

describe('inViewRange：在不在视图范围内', () => {
  it('两侧各 3 条以内在视图里，第 4 条起不在', () => {
    for (const distance of [0, 1, -1, 2, -2, 3, -3]) expect(inViewRange(distance)).toBe(true);
    for (const distance of [4, -4, 5, 100, -3000]) expect(inViewRange(distance)).toBe(false);
  });

  it('位置是小数时按绝对值算', () => {
    expect(inViewRange(2.9)).toBe(true);
    expect(inViewRange(3.1)).toBe(false);
  });
});

describe('visibleRange：要渲染的下标', () => {
  it('只取离浏览位置不到 4 的条目：整数位置时两侧各 3 张', () => {
    expect(visibleRange(5, 20)).toEqual([2, 8]);
  });

  it('位置是小数时多出一张', () => {
    expect(visibleRange(5.5, 20)).toEqual([2, 9]);
  });

  it('夹在条目范围内', () => {
    expect(visibleRange(0, 10)).toEqual([0, 3]);
    expect(visibleRange(9, 10)).toEqual([6, 9]);
    expect(visibleRange(3, 5)).toEqual([0, 4]);
  });

  it('只有 1 首时只有它', () => {
    expect(visibleRange(0, 1)).toEqual([0, 0]);
  });

  it('没有条目时是空范围', () => {
    const [first, last] = visibleRange(0, 0);
    expect(first).toBeGreaterThan(last);
  });
});

describe('visibleIndexes：补间全程要渲染的条目', () => {
  it('没动时就是目标处的两侧各 3 张', () => {
    expect(visibleIndexes(5, 5, 20)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('走一步是两端的并集，不重复、升序', () => {
    expect(visibleIndexes(5, 6, 20)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(visibleIndexes(6, 5, 20)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('隔得远时只渲染两端各自的卡，中间的不渲染', () => {
    expect(visibleIndexes(2, 15, 20)).toEqual([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18]);
  });

  it('位置已超出条目范围（条目被移走）时只取还在范围内的', () => {
    expect(visibleIndexes(30, 2, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('没有条目时是空', () => {
    expect(visibleIndexes(0, 0, 0)).toEqual([]);
  });
});

describe('coverflowLayout：封面边长、竖向位置与侧封面间距', () => {
  it('1280 × 800：封面 400，上沿 200，透视 1125', () => {
    const layout = coverflowLayout({ width: 1280, height: 800 });
    expect(layout).toMatchObject({ cover: 400, top: 200, perspective: 1125 });
  });

  it('封面中线对齐窗口中线：高度有余时上沿是 (窗高 − 封面) / 2', () => {
    for (const height of [600, 800, 1000, 1440]) {
      const { cover, top } = coverflowLayout({ width: 1920, height });
      expect(top + cover / 2).toBeCloseTo(height / 2, 0);
    }
  });

  it('窗高不够时封面取窗高一半，放不下间隔与标题就往上让', () => {
    const layout = coverflowLayout({ width: 1280, height: 466 });
    expect(layout.cover).toBe(233);
    expect(layout.top).toBe(109);
    // 下面放得下间隔 24、主副标题 76、窗底 24
    expect(layout.top + layout.cover + 124).toBeLessThanOrEqual(466);
  });

  it('再矮时封面缩到窗高减 180，上沿落到 56 以上', () => {
    const layout = coverflowLayout({ width: 1280, height: 364 });
    expect(layout.cover).toBe(182);
    expect(layout.top).toBe(58);
  });

  it('窄窗时封面不超过窗宽的 80%', () => {
    expect(coverflowLayout({ width: 300, height: 800 }).cover).toBe(240);
  });

  it('透视随封面等比', () => {
    const small = coverflowLayout({ width: 1280, height: 466 });
    expect(small.perspective).toBeCloseTo((900 * 233) / 320, 10);
  });

  it('窗宽放不下最外一级侧封面时间距收紧，使它的外沿正好在窗边', () => {
    const layout = coverflowLayout({ width: 1280, height: 800 });
    // 最外一级的脸外沿离中线 1.75 + 0.31 / 2 = 1.905 个封面
    expect(layout.spread).toBeCloseTo(640 / (400 * 1.905), 10);
    expect(layout.spread).toBeLessThan(1);
  });

  it('窗宽够用时间距不收紧', () => {
    expect(coverflowLayout({ width: 3840, height: 800 }).spread).toBe(1);
  });

  it('小到放不下时封面是 0，不出负数', () => {
    const layout = coverflowLayout({ width: 100, height: 100 });
    expect(layout.cover).toBe(0);
    expect(layout.top).toBe(56);
    expect(layout.spread).toBe(1);
  });

  it.each([400, 466, 540, 600, 700, 800, 1000, 1440])('窗高 %d：封面下方的内容放得下', (height) => {
    const layout = coverflowLayout({ width: 1920, height });
    expect(layout.top + layout.cover + 124).toBeLessThanOrEqual(Math.max(height, 56 + 124));
    expect(layout.top).toBeGreaterThanOrEqual(56);
  });
});
