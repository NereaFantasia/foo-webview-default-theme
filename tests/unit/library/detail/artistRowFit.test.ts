import { describe, expect, it } from 'vitest';
import { fitCount } from '../../../../src/library/detail/artistRowFit.ts';

describe('艺术家一行放得下几位', () => {
  it('全放得下就全放，不给箭头留位', () => {
    expect(fitCount([100, 120, 90], 20, 370, 44)).toBe(3);
    expect(fitCount([100], 20, 100, 44)).toBe(1);
    expect(fitCount([], 20, 300, 44)).toBe(0);
  });

  it('放不下时先给箭头留位，剩下的整枚排，不露半枚', () => {
    // 全放要 100+120+90+40 = 350 > 340；留出 44 后只剩 296：100+20+120 = 240 放得下，再加 20+90 = 350 放不下
    expect(fitCount([100, 120, 90], 20, 340, 44)).toBe(2);
    // 刚好放满可用宽度也算放得下
    expect(fitCount([100, 120, 90], 20, 284, 44)).toBe(2);
    expect(fitCount([100, 120, 90], 20, 283, 44)).toBe(1);
  });

  it('第一位就比一行宽时也排它，由名字自己截断', () => {
    expect(fitCount([500, 80], 20, 300, 44)).toBe(1);
    expect(fitCount([500], 20, 300, 44)).toBe(1);
  });
});
