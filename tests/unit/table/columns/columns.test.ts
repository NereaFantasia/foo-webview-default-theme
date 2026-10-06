import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  columnTrack,
  DEFAULT_ORDER,
  DEFAULT_WIDTHS,
  insertColumn,
  MIN_WIDTH,
  resizePair,
  swapColumns,
  toWidths,
  widthOf,
  withWidth,
} from '../../../../src/table/columns/columns.ts';

describe('列宽', () => {
  it('fr 列写成带最窄宽度保底的权重，其余列写像素', () => {
    expect(columnTrack('title', DEFAULT_WIDTHS)).toBe(`minmax(${MIN_WIDTH}px, 2fr)`);
    expect(columnTrack('duration', DEFAULT_WIDTHS)).toBe('60px');
  });

  it('缩略图列跟着表格给的缩略图边长走，不看存档里的宽度', () => {
    const track = columnTrack('art', DEFAULT_WIDTHS);
    expect(track).toContain('var(--table-art-size)');
    expect(columnTrack('art', withWidth(DEFAULT_WIDTHS, 'art', 500))).toBe(track);
  });

  it('按列名改一列的宽度，其余不动', () => {
    const next = withWidth(DEFAULT_WIDTHS, 'rating', 100);
    expect(widthOf(next, 'rating')).toBe(100);
    expect(widthOf(next, 'title')).toBe(widthOf(DEFAULT_WIDTHS, 'title'));
  });

  it('分隔条两侧一起改，和不变，两列都不窄于最窄宽度', () => {
    expect(resizePair(100, 100, 30)).toEqual([130, 70]);
    expect(resizePair(100, 100, 500)).toEqual([200 - MIN_WIDTH, MIN_WIDTH]);
    expect(resizePair(100, 100, -500)).toEqual([MIN_WIDTH, 200 - MIN_WIDTH]);
  });

  it('两列本来就放不下两个最窄宽度时不动', () => {
    expect(resizePair(20, 20, 10)).toEqual([20, 20]);
  });
});

describe('列序', () => {
  it('挪到目标前面或后面', () => {
    expect(insertColumn(DEFAULT_ORDER, 'duration', 'title', false)).toEqual([
      'cover',
      'status',
      'number',
      'art',
      'duration',
      ...DEFAULT_ORDER.slice(4, -1),
    ]);
    expect(insertColumn(DEFAULT_ORDER, 'number', 'artist', true).slice(3, 6)).toEqual([
      'title',
      'artist',
      'number',
    ]);
  });

  it('封面不参与换位，挪自己或挪不存在的列原样返回', () => {
    expect(insertColumn(DEFAULT_ORDER, 'cover', 'title', false)).toEqual(DEFAULT_ORDER);
    expect(insertColumn(DEFAULT_ORDER, 'title', 'cover', false)).toEqual(DEFAULT_ORDER);
    expect(insertColumn(DEFAULT_ORDER, 'title', 'title', true)).toEqual(DEFAULT_ORDER);
    expect(insertColumn(['cover', 'title'], 'artist', 'title', true)).toEqual(['cover', 'title']);
  });

  it('对调两列，中间的列不动', () => {
    expect(swapColumns(DEFAULT_ORDER, 'number', 'artist')).toEqual([
      'cover',
      'status',
      'artist',
      'art',
      'title',
      'number',
      ...DEFAULT_ORDER.slice(6),
    ]);
  });

  it('缺省列序是全部列的排列，封面打头，等级与时长在最右', () => {
    expect(new Set(DEFAULT_ORDER)).toEqual(new Set(COLUMNS.map((column) => column.id)));
    expect(DEFAULT_ORDER).toHaveLength(COLUMNS.length);
    expect(DEFAULT_ORDER[0]).toBe('cover');
    expect(DEFAULT_ORDER.slice(-2)).toEqual(['rating', 'duration']);
  });
});

describe('列宽的项数', () => {
  it('缺省列宽与收成的列宽都是全部列的项数，多的丢掉、缺的补 0', () => {
    expect(DEFAULT_WIDTHS).toHaveLength(COLUMNS.length);
    expect(toWidths([1, 2])).toEqual([1, 2, ...Array<number>(COLUMNS.length - 2).fill(0)]);
    expect(toWidths(Array<number>(COLUMNS.length + 3).fill(5))).toHaveLength(COLUMNS.length);
  });
});
