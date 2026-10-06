import { describe, expect, it } from 'vitest';
import {
  buildGridItems,
  GRID_METRICS,
  gridIndexOf,
  gridRowHeight,
  layoutRow,
  placeVisible,
  readingPositionOf,
  stepTileSize,
  tilesPerRow,
} from '../../../../src/library/album-wall/albumGridLayout.ts';
import type { AlbumSection } from '../../../../src/library/albumSections.ts';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

const BOUNDS = { min: 128, max: 256 };
const a = albumRow('A', 'X');
const b = albumRow('B', 'X');
const c = albumRow('C', 'X');
const d = albumRow('D', 'X');
const e = albumRow('E', 'X');

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

describe('stepTileSize', () => {
  it('一格一步、夹在区间内；到头或零格不动', () => {
    expect(stepTileSize(160, 1, 8, BOUNDS)).toBe(168);
    expect(stepTileSize(160, -2, 8, BOUNDS)).toBe(144);
    expect(stepTileSize(252, 1, 8, BOUNDS)).toBe(256);
    expect(stepTileSize(256, 1, 8, BOUNDS)).toBeUndefined();
    expect(stepTileSize(160, 0, 8, BOUNDS)).toBeUndefined();
  });
});

describe('条目流', () => {
  const sections: AlbumSection[] = [
    { key: 'Jazz', albums: [a, b, c] },
    { key: 'Rock', albums: [d] },
    { key: null, albums: [e] },
  ];

  it('每节一个节头，节内按列数切行；折叠的节只出节头', () => {
    const items = buildGridItems(sections, new Set(['Rock']), 2, {
      headers: true,
      repeats: false,
    });
    expect(
      items.map((item) =>
        item.kind === 'header'
          ? `h:${item.section.key}${item.collapsed ? '-' : '+'}`
          : item.albums.map((album) => album.name).join(''),
      ),
    ).toEqual(['h:Jazz+', 'AB', 'C', 'h:Rock-', 'h:null+', 'E']);
  });

  it('平铺档不出节头，也就没有可折叠的节', () => {
    const items = buildGridItems([{ key: null, albums: [a, b, c] }], new Set([null]), 2, {
      headers: false,
      repeats: false,
    });
    expect(items.map((item) => item.kind)).toEqual(['row', 'row']);
  });

  it('列数变了行跟着重切，图块跨行用同一个键', () => {
    const narrow = buildGridItems(sections, new Set(), 2, { headers: true, repeats: false });
    const wide = buildGridItems(sections, new Set(), 3, { headers: true, repeats: false });
    const layout = { tileSize: 100, spacing: 10, offset: 5 };
    const rowsOf = (items: typeof narrow) =>
      items.map((_, index) => ({ index, start: index * 50 }));
    const before = placeVisible(narrow, rowsOf(narrow), layout);
    const after = placeVisible(wide, rowsOf(wide), layout);
    const cBefore = before.find((tile) => tile.album === c);
    const cAfter = after.find((tile) => tile.album === c);
    expect(cBefore).toMatchObject({ key: albumKeyOf(c), index: 2, column: 0, x: 5 });
    expect(cAfter).toMatchObject({ key: albumKeyOf(c), index: 1, column: 2, x: 225 });
  });

  it('艺术家档的副本带上节键，两块不撞键', () => {
    const repeated: AlbumSection[] = [
      { key: 'A', albums: [a] },
      { key: 'B', albums: [a] },
    ];
    const items = buildGridItems(repeated, new Set(), 4, { headers: true, repeats: true });
    const tiles = placeVisible(
      items,
      items.map((_, index) => ({ index, start: 0 })),
      { tileSize: 100, spacing: 0, offset: 0 },
    );
    expect(tiles.map((tile) => tile.key)).toEqual([`A\0${albumKeyOf(a)}`, `B\0${albumKeyOf(a)}`]);
  });

  it('找一张专辑画在哪：先认给定的节，没有就取第一块；看不见时为 undefined', () => {
    const repeated: AlbumSection[] = [
      { key: 'A', albums: [b, a] },
      { key: 'B', albums: [a] },
    ];
    const items = buildGridItems(repeated, new Set(), 4, { headers: true, repeats: true });
    expect(gridIndexOf(items, albumKeyOf(a))).toEqual({ index: 1, column: 1 });
    expect(gridIndexOf(items, albumKeyOf(a), 'B')).toEqual({ index: 3, column: 0 });
    expect(gridIndexOf(items, albumKeyOf(a), 'Z')).toEqual({ index: 1, column: 1 });
    expect(gridIndexOf(items, albumKeyOf(e))).toBeUndefined();
  });

  it('阅读顺序里的位置跳过节头', () => {
    const items = buildGridItems(sections, new Set(), 2, { headers: true, repeats: false });
    expect(readingPositionOf(items, { index: 1, column: 1 })).toBe(1);
    expect(readingPositionOf(items, { index: 2, column: 0 })).toBe(2);
    expect(readingPositionOf(items, { index: 5, column: 0 })).toBe(4);
  });
});
