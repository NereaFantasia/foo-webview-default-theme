import { describe, expect, it } from 'vitest';
import { withDropdowns } from '../../../../src/library/album-wall/albumDropdown.ts';
import {
  buildGridItems,
  type GridItem,
} from '../../../../src/library/album-wall/albumGridLayout.ts';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import { anchoredScrollTop, reflowPlaces } from '../../../../src/library/album-wall/wallReflow.ts';
import { tileReflowKey } from '../../../../src/library/cover-tile/tileReflow.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

// 二十张专辑一节、带节头：节头高 40，图块行高 100。

const ALBUMS = Array.from({ length: 20 }, (_, index) => albumRow(`A${index}`, 'X'));
const SECTION = [{ key: 'x', albums: ALBUMS }];

function shape(perRow: number, items?: GridItem[]) {
  return {
    items: items ?? buildGridItems(SECTION, new Set(), perRow, { headers: true, repeats: false }),
    rowHeight: 100,
    headerHeight: 40,
  };
}

describe('anchoredScrollTop', () => {
  it('压着视口顶边的那一行的第一张换列后离顶边还是那么远', () => {
    // 四列时 A8 在第三行，上沿 40 + 200；滚到 250，它那一行离顶边 -10。五列时 A8 在第二行，上沿 140。
    expect(anchoredScrollTop(shape(4), shape(5), 250)).toBe(150);
    // 反过来：五列滚到 150，压着顶边的是 A5 那一行（上沿 140，离顶边 -10）；四列时 A5 在第二行。
    expect(anchoredScrollTop(shape(5), shape(4), 150)).toBe(150);
  });

  it('滚动在最顶上不动；顶边压着节头时锚第一行图块', () => {
    expect(anchoredScrollTop(shape(4), shape(5), 0)).toBe(0);
    // 滚到 20，顶边压着节头，往下第一行是 A0 那一行，上沿 40、离顶边 20：换列后还在 40。
    expect(anchoredScrollTop(shape(4), shape(5), 20)).toBe(20);
  });

  it('换列后找不到那张：不动', () => {
    expect(anchoredScrollTop(shape(4), shape(5, []), 250)).toBe(250);
  });
});

describe('reflowPlaces', () => {
  it('图块按自己的坐标，节头贴左，下拉与图块行同一个起点', () => {
    const first = ALBUMS[0] ?? albumRow('?', '?');
    const items = withDropdowns(
      buildGridItems(SECTION, new Set(), 4, { headers: true, repeats: false }),
      [{ id: 7, album: first, sectionKey: 'x', panel: 340 }],
      12,
    );
    const places = reflowPlaces(
      items,
      [
        { index: 0, start: 0 },
        { index: 1, start: 40 },
        { index: 2, start: 140 },
      ],
      [
        {
          key: 'k',
          albumKey: albumKeyOf(first),
          sectionKey: 'x',
          album: first,
          index: 1,
          column: 0,
          x: 12,
          y: 40,
        },
      ],
      12.4,
    );
    expect([...places]).toEqual([
      [tileReflowKey('k'), { x: 12, y: 40 }],
      ['h:x', { x: 0, y: 0 }],
      ['d:7', { x: 12, y: 140 }],
    ]);
  });
});
