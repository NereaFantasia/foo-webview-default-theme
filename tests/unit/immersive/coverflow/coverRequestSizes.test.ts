import { describe, expect, it } from 'vitest';
import { coverRequestSizes } from '../../../../src/immersive/coverflow/CoverflowCard.tsx';

// 封面按位置要的图：选中的按显示尺寸要，侧封面按最大一级（0.62 倍）要，向上取到宿主的 128 阶梯，夹在 256 到 1024 之间
describe('coverRequestSizes：各位置要多大的图', () => {
  it('1280 × 800（封面 400）：1×、1.5×、2× 屏', () => {
    expect(coverRequestSizes(400, 1)).toEqual({ center: 512, side: 256 });
    expect(coverRequestSizes(400, 1.5)).toEqual({ center: 640, side: 384 });
    expect(coverRequestSizes(400, 2)).toEqual({ center: 896, side: 512 });
  });

  it('选中的那张总不比侧封面小，侧封面总比它小', () => {
    for (const cover of [160, 233, 300, 400, 540, 720]) {
      for (const ratio of [1, 1.25, 1.5, 2, 3]) {
        const sizes = coverRequestSizes(cover, ratio);
        expect(sizes.center).toBeGreaterThanOrEqual(sizes.side);
        expect(sizes.side).toBeGreaterThanOrEqual(256);
        expect(sizes.center).toBeLessThanOrEqual(1024);
      }
    }
  });

  it('大封面高分屏封顶 1024', () => {
    expect(coverRequestSizes(540, 2)).toEqual({ center: 1024, side: 768 });
  });

  it('不比沉浸视图的封面（512 CSS 像素档）要得少，除非显示得本来就小', () => {
    // 沉浸视图 1.5× 屏要 768，400 的封面只需 600 物理像素，640 已经够清；封面显示到 512 以上时两边一样大
    expect(coverRequestSizes(512, 1.5).center).toBe(768);
    expect(coverRequestSizes(512, 2).center).toBe(1024);
  });
});
