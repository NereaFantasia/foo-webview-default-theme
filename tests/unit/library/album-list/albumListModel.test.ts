import type { LibraryTrack } from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildListItems,
  buildListOrders,
  sectionKeysOf,
  type AlbumListGroup,
} from '../../../../src/library/album-list/albumListModel.ts';
import { albumKeyOf, type Album } from '../../../../src/host/libraryContract.ts';
import { listCollapseOf } from '../../../../src/library/album-list/listCollapse.ts';
import type { TableItem } from '../../../../src/table/tableItems.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';

const BLUE = albumRow('Blue Train', 'John Coltrane', { trackCount: 2 });
const KIND = albumRow('Kind of Blue', 'Miles Davis', { trackCount: 3 });
const WALL = albumRow('The Wall', 'Pink Floyd', { trackCount: 1 });
const TRACKS: Readonly<Record<string, readonly LibraryTrack[]>> = {
  'Blue Train': [trackRow('Blue Train', 'b1'), trackRow('Blue Train', 'b2')],
  'The Wall': [trackRow('The Wall', 'w1')],
};
const SECTIONS = [
  { key: 'Jazz', albums: [BLUE, KIND] },
  { key: 'Rock', albums: [WALL] },
];

const loaded = (album: Album) => TRACKS[album.name];

/** 条目流写成一串短记号，一眼看得出摊成了什么样。 */
function shape(items: readonly TableItem<AlbumListGroup>[]): string[] {
  return items.map((item) => {
    if (item.kind === 'filler') return '_';
    if (item.kind === 'row') return `${item.order}:${item.track?.title ?? '?'}`;
    const { data } = item;
    const name = data.kind === 'section' ? `§${data.section.key}` : data.entry.album.name;
    return `${name}${item.collapsed ? '+' : ''}@${item.level}`;
  });
}

describe('buildListOrders', () => {
  it('按显示顺序排行序号；曲目没到的专辑按首数占位，行序号上没有曲目', () => {
    const orders = buildListOrders(SECTIONS, true, loaded);
    expect(orders.total).toBe(6);
    expect(orders.sections.map((section) => section.span)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 6 },
    ]);
    expect(orders.trackAt(1)?.title).toBe('b2');
    expect(orders.trackAt(3)).toBeUndefined();
    expect(orders.albumAt(3)?.album).toBe(KIND);
    expect(orders.albumAt(5)?.span).toEqual({ start: 5, end: 6 });
    expect(orders.trackAt(9)).toBeUndefined();
  });

  it('同一张专辑出现在几节里，各节的分组键不同；批量开合拿到各节的专辑键', () => {
    const orders = buildListOrders(
      [
        { key: 'A', albums: [BLUE] },
        { key: 'B', albums: [BLUE] },
      ],
      true,
      loaded,
    );
    const [first, second] = orders.sections.map((section) => section.albums[0]?.groupKey);
    expect(first).not.toBe(second);
    expect(sectionKeysOf(orders)).toEqual([
      { key: 'A', albums: [albumKeyOf(BLUE)] },
      { key: 'B', albums: [albumKeyOf(BLUE)] },
    ]);
  });
});

describe('buildListItems', () => {
  const orders = buildListOrders(SECTIONS, true, loaded);

  it('节、专辑、曲目三层；行数不到封面高时在组尾垫空位', () => {
    const items = buildListItems(orders, listCollapseOf({ wall: {} }, 'genre'), 3);
    expect(shape(items)).toEqual([
      '§Jazz@0',
      'Blue Train@1',
      '0:b1',
      '1:b2',
      '_',
      'Kind of Blue@1',
      '2:?',
      '3:?',
      '4:?',
      '§Rock@0',
      'The Wall@1',
      '5:w1',
      '_',
      '_',
    ]);
  });

  it('收着的节与专辑不出下面的条目，行序号照旧留着；平铺档的专辑在最外层', () => {
    const value = {
      wall: {},
      list: { genre: ['Rock'] },
      listAlbums: { collapsedByDefault: false, except: [albumKeyOf(BLUE)] },
    };
    const items = buildListItems(orders, listCollapseOf(value, 'genre'), 0);
    expect(shape(items)).toEqual([
      '§Jazz@0',
      'Blue Train+@1',
      'Kind of Blue@1',
      '2:?',
      '3:?',
      '4:?',
      '§Rock+@0',
    ]);
    const flat = buildListOrders([{ key: null, albums: [WALL] }], false, loaded);
    expect(shape(buildListItems(flat, listCollapseOf({ wall: {} }, 'album'), 0))).toEqual([
      'The Wall@0',
      '0:w1',
    ]);
  });

  it('行的键按专辑里的第几首记：曲目到手前后同一行键不变', () => {
    const skeleton = buildListOrders(SECTIONS, true, () => undefined);
    const collapse = listCollapseOf({ wall: {} }, 'genre');
    const before = buildListItems(skeleton, collapse, 0).filter((item) => item.kind === 'row');
    const after = buildListItems(orders, collapse, 0).filter((item) => item.kind === 'row');
    expect(before.slice(0, 2).map((item) => item.key)).toEqual(
      after.slice(0, 2).map((item) => item.key),
    );
  });
});
