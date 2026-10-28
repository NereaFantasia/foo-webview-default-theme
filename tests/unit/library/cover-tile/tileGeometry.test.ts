import { describe, expect, it } from 'vitest';
import { GRID_METRICS } from '../../../../src/library/album-wall/albumGridLayout.ts';
import {
  flatHeight,
  flatPlace,
  gridRowHeight,
  layoutRow,
  STANDARD_TILE_METRICS,
  tailShift,
  tilesPerRow,
} from '../../../../src/library/cover-tile/tileGeometry.ts';

const BOUNDS = { min: 128, max: 256 };

describe('列数', () => {
  it('只按内容卡的内宽算：间距只在块与块之间', () => {
    expect(tilesPerRow(160 * 3 + 12 * 2, 160, 12)).toBe(3);
    expect(tilesPerRow(160 * 3 + 12 * 2 - 1, 160, 12)).toBe(2);
    expect(tilesPerRow(100, 160, 12)).toBe(1);
  });

  it('还没量出宽度时按一块', () => {
    expect(tilesPerRow(0, 160, 12)).toBe(1);
    expect(layoutRow(0, 160, GRID_METRICS.grid, BOUNDS)).toEqual({
      perRow: 1,
      tileSize: 160,
      spacing: 12,
      offset: 0,
    });
  });

  it('余量先补间距到上限，剩下的两侧均分；不拉伸的档余量全去两侧', () => {
    const wide = layoutRow(1000, 160, GRID_METRICS.grid, BOUNDS);
    expect(wide.perRow).toBe(5);
    expect(wide.spacing).toBe(24);
    expect(wide.offset).toBe((1000 - (5 * 160 + 4 * 24)) / 2);
    const compact = layoutRow(1000, 160, GRID_METRICS.compact, BOUNDS);
    expect(compact.perRow).toBe(6);
    expect(compact.spacing).toBe(6);
  });

  it('边长夹在区间内', () => {
    expect(layoutRow(1000, 999, GRID_METRICS.grid, BOUNDS).tileSize).toBe(256);
    expect(layoutRow(1000, 3, GRID_METRICS.grid, BOUNDS).tileSize).toBe(128);
  });

  it('行高是边长加行间距，有字档再加两行字', () => {
    expect(gridRowHeight(160, GRID_METRICS.grid)).toBe(160 + 36 + 12);
    expect(gridRowHeight(160, GRID_METRICS.gridNoText)).toBe(160 + 12);
  });
});

describe('平铺网格', () => {
  const row = layoutRow(1000, 160, STANDARD_TILE_METRICS, { min: 160, max: 160 });

  it('第 n 块的位置按行优先排，横坐标取整、与墙同一个算式', () => {
    expect(row.perRow).toBe(5);
    const second = flatPlace(1, row, 208);
    expect(second.column).toBe(1);
    expect(second.x).toBe(Math.round(row.offset + (160 + row.spacing)));
    expect(second.y).toBe(0);
    const sixth = flatPlace(5, row, 208);
    expect(sixth).toEqual({ column: 0, x: Math.round(row.offset), y: 208 });
  });

  it('末行不满时整行右移空位的一半，满行与其余行不动；不足一行时同样居中', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => tailShift(index, 8, 5))).toEqual([
      0, 0, 0, 0, 0, 1, 1, 1,
    ]);
    expect([0, 1, 2].map((index) => tailShift(index, 3, 6))).toEqual([1.5, 1.5, 1.5]);
    expect([0, 4, 9].map((index) => tailShift(index, 10, 5))).toEqual([0, 0, 0]);
    expect(flatPlace(5, row, 208, 1).column).toBe(1);
  });

  it('总高：行间距只在行与行之间，没有条目时为 0', () => {
    expect(flatHeight(0, 5, 208, 12)).toBe(0);
    expect(flatHeight(5, 5, 208, 12)).toBe(196);
    expect(flatHeight(6, 5, 208, 12)).toBe(2 * 208 - 12);
  });

  it('标准档与封面墙默认档同值', () => {
    expect(STANDARD_TILE_METRICS).toEqual({ gap: 12, stretch: 2, textHeight: 36, lineHeight: 16 });
    expect(GRID_METRICS.grid).toEqual({ ...STANDARD_TILE_METRICS, headerHeight: 32 });
  });
});
