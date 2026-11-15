import { describe, expect, it } from 'vitest';
import {
  BLUR_FEATHER,
  BLUR_SCALE,
  SHARP_FEATHER,
  FEATHER_HOLD,
  featherMask,
  featherShapes,
} from '../../../../src/immersive/bleed-cover/feather.ts';

// 羽化必须在盒内归零，否则被右界截成硬边；渐隐段用五次平滑曲线，折线会露台阶

describe('羽化的几何', () => {
  it('清晰层：半径 80% × 104%，从 38% 起渐隐', () => {
    expect(SHARP_FEATHER.rx).toBe(80);
    expect(SHARP_FEATHER.ry).toBeCloseTo(104, 6);
    expect(SHARP_FEATHER.inner).toBeCloseTo(0.475, 6);
  });

  it('模糊层：把盒内的 38% 与 95% 按放大倍数换算成元素自身坐标，归零点仍在盒内 95%', () => {
    expect(BLUR_SCALE).toBe(1.06);
    expect(BLUR_FEATHER.rx).toBeCloseTo(92.45, 2);
    expect(BLUR_FEATHER.ry).toBeCloseTo(120.2, 1);
    expect(BLUR_FEATHER.inner).toBeCloseTo(0.418, 3);
    // 自身坐标 x 对应盒内坐标 50 + (x − 50) × 放大倍数
    expect(50 + (BLUR_FEATHER.rx - 50) * BLUR_SCALE).toBeCloseTo(95, 6);
  });

  it('模糊层比清晰层晚归零：中段露出纯模糊', () => {
    const sharpEnd = SHARP_FEATHER.rx;
    const blurEnd = 50 + (BLUR_FEATHER.rx - 50) * BLUR_SCALE;
    expect(blurEnd).toBeGreaterThan(sharpEnd);
  });
});

describe('featherMask', () => {
  const mask = featherMask(SHARP_FEATHER);
  const stops = [
    ...mask.matchAll(
      /color-mix\(in srgb, var\(--colorNeutralForeground1\) ([\d.]+)%, transparent\) ([\d.]+)%/g,
    ),
  ].map((match) => ({ alpha: Number(match[1]), at: Number(match[2]) }));

  it('圆心钉在左缘中点；内圈内全不透明，到 100% 全透明', () => {
    expect(mask.startsWith('radial-gradient(ellipse 80% 104% at 0% 50%, ')).toBe(true);
    expect(mask).toContain('var(--colorNeutralForeground1) 47.5%');
    expect(mask.endsWith('transparent 100%)')).toBe(true);
  });

  it('渐隐段取 14 个中间点，位置递增、不透明度严格递减', () => {
    expect(stops).toHaveLength(14);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index]!.at).toBeGreaterThan(stops[index - 1]!.at);
      expect(stops[index]!.alpha).toBeLessThan(stops[index - 1]!.alpha);
    }
    expect(stops[0]!.at).toBeGreaterThan(47.5);
    expect(stops.at(-1)!.at).toBeLessThan(100);
  });

  it('两端斜率为零：第一个点几乎还是全不透明，最后一个点几乎已经透明（折线会在这里露台阶）', () => {
    expect(stops[0]!.alpha).toBeGreaterThan(99);
    expect(stops.at(-1)!.alpha).toBeLessThan(1);
  });

  it('偏向不透明：每个点都比纯五次平滑曲线更不透明，正中比一半高一截，但端点不变', () => {
    const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    expect(FEATHER_HOLD).toBeGreaterThan(1);
    for (const stop of stops) {
      const t = (stop.at - 47.5) / (100 - 47.5);
      expect(stop.alpha).toBeGreaterThan(100 * (1 - smoother(t)));
    }
    const middle = stops.find((stop) => Math.abs((stop.at - 47.5) / (100 - 47.5) - 0.5) < 0.04);
    expect(middle!.alpha).toBeGreaterThan(58);
    expect(
      mask.startsWith(
        'radial-gradient(ellipse 80% 104% at 0% 50%, var(--colorNeutralForeground1) 47.5%',
      ),
    ).toBe(true);
    expect(mask.endsWith('transparent 100%)')).toBe(true);
  });

  it('不写字面色值，只借 Fluent 前景色的透明度', () => {
    for (const shape of [SHARP_FEATHER, BLUR_FEATHER]) {
      const text = featherMask(shape);
      expect(text).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|hsl\(/i);
    }
  });
});

describe('featherShapes：起点与宽度算出两层的终点', () => {
  it('缺省的 38 加 42 就是原来定稿的几何', () => {
    const shapes = featherShapes(38, 42);
    expect(shapes.sharp).toEqual(SHARP_FEATHER);
    expect(shapes.blur).toEqual(BLUR_FEATHER);
  });

  it('清晰层终点 = 起点 + 宽度（至多 98），模糊层再晚 15（至多 100）：先后次序由构造保证', () => {
    for (const start of [20, 38, 60]) {
      for (const width of [20, 42, 60]) {
        const { sharp, blur } = featherShapes(start, width);
        const sharpEnd = sharp.rx;
        const blurEnd = 50 + (blur.rx - 50) * BLUR_SCALE;
        expect(sharpEnd).toBeLessThanOrEqual(98);
        expect(blurEnd).toBeLessThanOrEqual(100 + 1e-9);
        expect(blurEnd).toBeGreaterThan(sharpEnd);
        expect(sharp.inner).toBeGreaterThan(0);
        expect(sharp.inner).toBeLessThan(1);
        expect(blur.inner).toBeLessThan(1);
      }
    }
  });

  it('浓度参数：1 是纯曲线，越大同一位置越不透明，端点不变', () => {
    const alphaAt = (hold: number) => {
      const text = featherMask(SHARP_FEATHER, hold);
      const stops = [
        ...text.matchAll(
          /color-mix\(in srgb, var\(--colorNeutralForeground1\) ([\d.]+)%, transparent\) ([\d.]+)%/g,
        ),
      ].map((match) => Number(match[1]));
      return { stops, text };
    };
    const plain = alphaAt(1);
    const dense = alphaAt(2);
    for (let index = 0; index < plain.stops.length; index += 1)
      expect(dense.stops[index]!).toBeGreaterThanOrEqual(plain.stops[index]!);
    expect(dense.text.endsWith('transparent 100%)')).toBe(true);
  });
});
