import { describe, expect, it } from 'vitest';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import {
  COLUMNS,
  DEFAULT_ORDER,
  DEFAULT_WIDTHS,
  MIN_WIDTH,
  type ColumnId,
} from '../../../../src/table/columns/columns.ts';
import {
  loadColumns,
  saveColumns,
  type StoredColumns,
} from '../../../../src/table/columns/columnsStorage.ts';

const KEY = 'default-theme.album-detail-columns.v1';
const FALLBACK: StoredColumns = {
  widths: DEFAULT_WIDTHS,
  hidden: ['status'],
  order: DEFAULT_ORDER,
};

function memory(initial?: unknown): PrefStorage & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  if (initial !== undefined) {
    saved.set(KEY, typeof initial === 'string' ? initial : JSON.stringify(initial));
  }
  return {
    saved,
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  };
}

/** 专辑艺术家到路径的九列，按缺省列序。 */
const LATER: readonly ColumnId[] = [
  'albumArtist',
  'year',
  'genre',
  'added',
  'playCount',
  'lastPlayed',
  'codec',
  'bitrate',
  'path',
];
/** 八项那一版之后加的十列，按 `COLUMNS` 的下标；读回时按这个次序记成藏着。 */
const ADDED: readonly ColumnId[] = [...LATER, 'art'];
/** 八项那一版的列宽与列序。 */
const WIDTHS_8 = [100, 24, 40, 300, 200, 88, 60, 150];
const ORDER_8: ColumnId[] = [
  'cover',
  'number',
  'title',
  'status',
  'artist',
  'album',
  'rating',
  'duration',
];
/** 全部列的一份合法存档；缩略图列插在缺省列序里它前面的序号列后面。 */
const WIDTHS = [...WIDTHS_8, 1, 52, 96, 96, 60, 96, 64, 72, 2, 48];
const ORDER: ColumnId[] = [
  'cover',
  'number',
  'art',
  ...ORDER_8.slice(2, 6),
  ...LATER,
  'rating',
  'duration',
];

describe('读回存档', () => {
  it('合法的存档原样读回', () => {
    const storage = memory({ widths: WIDTHS, hidden: ['album'], order: ORDER });
    expect(loadColumns(storage, KEY, FALLBACK)).toEqual({
      widths: WIDTHS,
      hidden: ['album'],
      order: ORDER,
    });
  });

  it('没有存档、JSON 坏了、存储读不了或不是对象时给缺省', () => {
    const throwing: PrefStorage = {
      getItem: () => {
        throw new Error('禁用');
      },
      setItem: () => {},
    };
    expect(loadColumns(memory(), KEY, FALLBACK)).toBe(FALLBACK);
    expect(loadColumns(memory('{oops'), KEY, FALLBACK)).toBe(FALLBACK);
    expect(loadColumns(throwing, KEY, FALLBACK)).toBe(FALLBACK);
    expect(loadColumns(memory([1, 2, 3]), KEY, FALLBACK)).toBe(FALLBACK);
    expect(loadColumns(null, KEY, FALLBACK)).toBe(FALLBACK);
  });

  const withAt = (at: number, value: unknown) =>
    WIDTHS.map((width, i) => (i === at ? value : width));
  it.each([
    ['项数不是哪一版', [1, 2, 3]],
    ['项数在两版之间', WIDTHS.slice(0, 9)],
    ['有负数', withAt(5, -1)],
    ['有非数', withAt(5, 'wide')],
    ['有无穷大', withAt(5, Number.POSITIVE_INFINITY)],
    ['不是数组', { title: 3 }],
  ])('列宽%s时整份回缺省', (_, widths) => {
    const storage = memory({ widths, hidden: ['album'], order: ORDER });
    expect(loadColumns(storage, KEY, FALLBACK)).toBe(FALLBACK);
  });

  it('宽度没有上限：宽容器上拖出来的列宽读得回来', () => {
    const widths = withAt(2, 5000).map((width, i) => (i === 3 ? 3000 : width));
    const storage = memory({ widths, hidden: [], order: ORDER });
    expect(loadColumns(storage, KEY, FALLBACK).widths).toEqual(widths);
  });

  it('定宽列一律取缺省宽度；存像素的列夹到最窄宽度，封面与 fr 列不夹', () => {
    const widths = [0, 90, 5, 0.5, 0, 10, 12, 1, 0.25, 3, 3, 3, 3, 3, 3, 3, 0, 7];
    const storage = memory({ widths, hidden: [], order: ORDER });
    const flexible = new Set(COLUMNS.filter((column) => column.flexible).map((c) => c.id));
    expect(loadColumns(storage, KEY, FALLBACK).widths).toEqual(
      COLUMNS.map((column, at) => {
        if (column.fixed) return DEFAULT_WIDTHS[at];
        if (column.id === 'cover' || flexible.has(column.id)) return widths[at];
        return MIN_WIDTH;
      }),
    );
  });

  it('宽度 0 合法：封面列拖到 0 就是关掉', () => {
    const widths = [0, ...WIDTHS.slice(1)];
    expect(loadColumns(memory({ widths, hidden: [], order: ORDER }), KEY, FALLBACK).widths).toEqual(
      widths,
    );
  });

  it('显隐里不认的列、标题列与重复项丢掉；不是数组就全显示', () => {
    const storage = memory({
      widths: WIDTHS,
      hidden: ['album', 'title', 'album', 'lyrics', 3],
      order: ORDER,
    });
    expect(loadColumns(storage, KEY, FALLBACK).hidden).toEqual(['album']);
    const missing = memory({ widths: WIDTHS, hidden: 'album', order: ORDER });
    expect(loadColumns(missing, KEY, FALLBACK).hidden).toEqual([]);
  });

  it.each([
    ['缺列', ORDER.slice(0, -1)],
    ['重复', ['cover', 'title', 'title', ...ORDER.slice(3)]],
    ['封面不打头', ['number', 'cover', ...ORDER.slice(2)]],
    ['有不认的列', ['cover', 'lyrics', ...ORDER.slice(2)]],
  ])('列序%s时只回退列序，列宽与显隐保留', (_, order) => {
    const loaded = loadColumns(memory({ widths: WIDTHS, hidden: ['album'], order }), KEY, FALLBACK);
    expect(loaded).toEqual({ widths: WIDTHS, hidden: ['album'], order: DEFAULT_ORDER });
  });

  it('八项的存档补上后来的十列：取缺省宽，缩略图插在序号后、其余插在专辑后，都记成藏着', () => {
    const storage = memory({ widths: WIDTHS_8, hidden: ['album'], order: ORDER_8 });
    expect(loadColumns(storage, KEY, FALLBACK)).toEqual({
      widths: [...WIDTHS_8, ...DEFAULT_WIDTHS.slice(8)],
      hidden: ['album', ...ADDED],
      order: ORDER,
    });
  });

  it('七项的旧存档补上专辑列与后来的十列：专辑权重同艺术家、插在艺术家后面，都记成藏着', () => {
    const storage = memory({
      widths: WIDTHS_8.slice(0, 7),
      hidden: ['status'],
      order: ['cover', 'number', 'title', 'artist', 'status', 'rating', 'duration'],
    });
    expect(loadColumns(storage, KEY, FALLBACK)).toEqual({
      widths: [...WIDTHS_8.slice(0, 7), WIDTHS_8[4], ...DEFAULT_WIDTHS.slice(8)],
      hidden: ['status', 'album', ...ADDED],
      order: [
        'cover',
        'number',
        'art',
        'title',
        'artist',
        'album',
        ...LATER,
        'status',
        'rating',
        'duration',
      ],
    });
  });

  it('八项的列宽配了全部列的列序也认', () => {
    const storage = memory({ widths: WIDTHS_8, hidden: [], order: ORDER });
    expect(loadColumns(storage, KEY, FALLBACK).order).toEqual(ORDER);
  });
});

describe('写存档', () => {
  it('写进去的能原样读回', () => {
    const storage = memory();
    const columns: StoredColumns = { widths: DEFAULT_WIDTHS, hidden: ['rating'], order: ORDER };
    saveColumns(storage, KEY, columns);
    expect(JSON.parse(storage.saved.get(KEY) ?? 'null')).toEqual({
      widths: [...DEFAULT_WIDTHS],
      hidden: ['rating'],
      order: ORDER,
    });
    expect(loadColumns(storage, KEY, FALLBACK)).toEqual(columns);
  });

  it('存储写不进去时不抛', () => {
    const full: PrefStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('满了');
      },
    };
    expect(() => saveColumns(full, KEY, FALLBACK)).not.toThrow();
  });
});
