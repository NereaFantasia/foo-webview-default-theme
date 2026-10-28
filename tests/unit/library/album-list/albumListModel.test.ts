import type { LibraryTrack } from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import {
  albumsByHandle,
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
  it('列头只重排专辑内曲目，保留分节、专辑顺序与原数组，同值保持原序', () => {
    const two = trackRow('Blue Train', '曲目 2', { trackNumber: 1 });
    const ten = trackRow('Blue Train', '曲目 10', { trackNumber: 2 });
    const same = trackRow('Blue Train', '曲目 2', { trackNumber: 3, path: 'E:\\same.flac' });
    const original = [two, ten, same];
    const rows = (album: Album) => (album === BLUE ? original : loaded(album));
    for (const descending of [false, true]) {
      const orders = buildListOrders(SECTIONS, true, rows, { column: 'title', descending });
      expect(orders.sections.map((section) => section.key)).toEqual(['Jazz', 'Rock']);
      expect(orders.sections[0]?.albums.map((entry) => entry.album)).toEqual([BLUE, KIND]);
      expect(orders.sections[0]?.albums[0]?.tracks).toEqual(
        descending ? [ten, two, same] : [two, same, ten],
      );
      expect(orders.trackAt(0)).toBe(descending ? ten : two);
      expect(orders.albumAt(2)?.album).toBe(BLUE);
    }
    expect(original).toEqual([two, ten, same]);
  });

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

describe('不按专辑分组', () => {
  const KIND_TRACKS = ['k1', 'k2', 'k3'].map((title) => trackRow('Kind of Blue', title));
  const all = (album: Album) => (album === KIND ? KIND_TRACKS : loaded(album));
  const open = listCollapseOf({ wall: {} }, 'genre');

  it('各节里的曲目按专辑次序连起来后整体排，没有专辑分组头，行序号归节', () => {
    const orders = buildListOrders(
      SECTIONS,
      true,
      all,
      { column: 'title', descending: true },
      true,
    );
    expect(orders.flat).toBe(true);
    expect(shape(buildListItems(orders, open, 160))).toEqual([
      '§Jazz@0',
      '0:k3',
      '1:k2',
      '2:k1',
      '3:b2',
      '4:b1',
      '§Rock@0',
      '5:w1',
    ]);
    expect(orders.sections[0]?.span).toEqual({ start: 0, end: 5 });
    expect(orders.sections[0]?.albums.map((entry) => entry.album)).toEqual([BLUE, KIND]);
    expect(orders.albumAt(0)?.album).toBe(KIND);
    expect(orders.albumAt(4)?.album).toBe(BLUE);
  });

  it('不给排序时保持专辑次序；整体排序不跨节，不分节时跨专辑', () => {
    const tree = buildListOrders(SECTIONS, true, all, undefined, true);
    expect(shape(buildListItems(tree, open, 0)).slice(1, 6)).toEqual([
      '0:b1',
      '1:b2',
      '2:k1',
      '3:k2',
      '4:k3',
    ]);
    const whole = buildListOrders(
      [{ key: null, albums: [BLUE, WALL] }],
      false,
      loaded,
      { column: 'title', descending: true },
      true,
    );
    expect(shape(buildListItems(whole, open, 0))).toEqual(['0:w1', '1:b2', '2:b1']);
  });

  it('节里有专辑的曲目没到，这一节先按首数占骨架行；折叠的节不出行', () => {
    const skeleton = buildListOrders(SECTIONS, true, loaded, undefined, true);
    expect(shape(buildListItems(skeleton, open, 0))).toEqual([
      '§Jazz@0',
      '0:?',
      '1:?',
      '2:?',
      '3:?',
      '4:?',
      '§Rock@0',
      '5:w1',
    ]);
    const folded = listCollapseOf({ wall: {}, list: { genre: ['Jazz'] } }, 'genre');
    expect(shape(buildListItems(skeleton, folded, 0))).toEqual(['§Jazz+@0', '§Rock@0', '5:w1']);
  });
});

describe('albumsByHandle', () => {
  it('已取到的曲目按 handle 对应到专辑，没取到的专辑不出现；平铺与分组一样', () => {
    for (const flat of [false, true]) {
      const orders = buildListOrders(SECTIONS, true, loaded, undefined, flat);
      const owners = albumsByHandle(orders);
      expect(owners.get(TRACKS['Blue Train']?.[1]?.handle ?? '')).toBe(BLUE);
      expect(owners.get(TRACKS['The Wall']?.[0]?.handle ?? '')).toBe(WALL);
      expect(owners.size).toBe(3);
    }
  });
});
