import { describe, expect, it } from 'vitest';
import { RAIL_PEEK, railLayout, type RailShape } from '../../../../src/library/home/homeRail.ts';

const COVER: RailShape = { min: 140, max: 220, per: 5 };
const GAP = 16;

describe('横排行的条目宽度', () => {
  it('宽度在上下限之间时每屏整张数不变，右边留出固定的露边', () => {
    for (const rowWidth of [824, 938, 1066, 1224]) {
      const { width, count, paged } = railLayout(rowWidth, 12, COVER, GAP);
      expect(count).toBe(5);
      expect(paged).toBe(true);
      expect(rowWidth - count * (width + GAP)).toBeCloseTo(RAIL_PEEK);
    }
    expect(railLayout(938, 12, COVER, GAP).width).toBeCloseTo(162.8);
  });

  it('到下限后减少张数，到上限后攒够一张才多露一张', () => {
    expect(railLayout(462, 12, COVER, GAP)).toMatchObject({ width: 140, count: 2 });
    expect(railLayout(700, 12, COVER, GAP)).toMatchObject({ width: 140, count: 4 });
    expect(railLayout(1300, 12, COVER, GAP)).toMatchObject({ width: 220, count: 5 });
    expect(railLayout(1460, 12, COVER, GAP)).toMatchObject({ width: 220, count: 6 });
  });

  it('行宽逐像素变大时宽度不变小，也不超出上下限', () => {
    const shapes: readonly (readonly [RailShape, number])[] = [
      [COVER, 12],
      [COVER, 3],
      [{ min: 300, max: 480, per: 2 }, 8],
      [{ min: 300, max: 480, per: 2 }, 2],
      [{ min: 280, max: 380, per: 3 }, 7],
      [{ min: 96, max: 140, per: 7 }, 14],
    ];
    for (const [shape, items] of shapes) {
      let previous = 0;
      for (let rowWidth = 320; rowWidth <= 2400; rowWidth += 1) {
        const { width } = railLayout(rowWidth, items, shape, GAP);
        expect(width).toBeGreaterThanOrEqual(previous - 1e-6);
        expect(width).toBeGreaterThanOrEqual(Math.min(shape.min, rowWidth) - 1e-6);
        expect(width).toBeLessThanOrEqual(shape.max + 1e-6);
        previous = width;
      }
    }
  });

  it('一屏放得下时不翻页、不留露边，宽度撑满到上限', () => {
    expect(railLayout(938, 5, COVER, GAP)).toMatchObject({ count: 5, paged: false });
    expect(5 * railLayout(938, 5, COVER, GAP).width + 4 * GAP).toBeCloseTo(938);
    expect(railLayout(1600, 3, COVER, GAP)).toMatchObject({ width: 220, count: 3, paged: false });
    expect(railLayout(300, 1, COVER, GAP)).toMatchObject({ width: 220, count: 1, paged: false });
  });

  it('行宽比下限还窄时条目不超出行宽', () => {
    expect(railLayout(100, 12, COVER, GAP).width).toBe(100);
    expect(railLayout(100, 1, COVER, GAP).width).toBe(100);
  });
});
