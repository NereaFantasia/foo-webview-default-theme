import { describe, expect, it } from 'vitest';
import {
  DROPDOWN_METRICS,
  dropdownCoverSize,
  dropdownPanelHeight,
  flowItemSize,
  itemTops,
  rowHolding,
  scrollTargetFor,
  trackCell,
  trackColumns,
  trackLines,
  withDropdowns,
  type DropdownPlacement,
} from '../../../../src/library/album-wall/albumDropdown.ts';
import {
  buildGridItems,
  type GridItem,
} from '../../../../src/library/album-wall/albumGridLayout.ts';
import type { AlbumSection } from '../../../../src/library/albumSections.ts';
import { albumKeyOf, type Album } from '../../../../src/host/libraryContract.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

const [a, b, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map((name) => albumRow(name, 'X')) as [
  Album,
  Album,
  Album,
  Album,
  Album,
];
const GAP = 12;
const sections: AlbumSection[] = [
  { key: 'Jazz', albums: [a, b, c] },
  { key: 'Rock', albums: [d, e] },
];

function flow(perRow: number) {
  return buildGridItems(sections, new Set(), perRow, { headers: true, repeats: false });
}

function place(album: Album, id = 1, panel = 300, sectionKey: string | null = null) {
  const placement: DropdownPlacement = { id, album, sectionKey, panel };
  return placement;
}

/** 条目流写成一串：节头 h:键、图块行按专辑名连写、下拉 v:专辑名@列。 */
function shape(items: readonly GridItem[]): string[] {
  return items.map((item) => {
    if (item.kind === 'header') return `h:${item.section.key}`;
    if (item.kind === 'dropdown') return `v:${item.album.name}@${item.column}`;
    return item.albums.map((album) => album.name).join('');
  });
}

describe('高度', () => {
  it('八首以内一栏，超过分两栏、左栏先排满；露出的行数至多 8', () => {
    expect([0, 1, 8, 9, 15, 16, 17, 200].map(trackLines)).toEqual([0, 1, 8, 5, 8, 8, 8, 8]);
    expect([8, 9].map(trackColumns)).toEqual([1, 2]);
  });

  it('面板高固定：头、八行曲目与尾正好是封面边长，不论首数', () => {
    const { head, foot, rowHeight, cover } = DROPDOWN_METRICS;
    expect(cover).toBe(head + 8 * rowHeight + foot);
    expect([0, 1, 8, 16, 17, 200].map(dropdownPanelHeight)).toEqual(Array(6).fill(cover));
  });

  it('封面框的宽不随首数变，窄面板里让到面板宽的四成', () => {
    expect(dropdownCoverSize(1000)).toBe(DROPDOWN_METRICS.cover);
    expect(dropdownCoverSize(600)).toBe(240);
    expect(dropdownCoverSize(0)).toBe(0);
  });

  it('曲目的格：一栏一首一行；两栏时一段 16 首先排满左栏，最后一段两栏对半、左栏多一首', () => {
    const cells = (count: number) =>
      Array.from({ length: count }, (_, index) => {
        const { row, column } = trackCell(index, count);
        return `${row}.${column}`;
      });
    expect(cells(3)).toEqual(['1.1', '2.1', '3.1']);
    expect(cells(9)).toEqual(['1.1', '2.1', '3.1', '4.1', '5.1', '1.2', '2.2', '3.2', '4.2']);
    const long = cells(21);
    expect(long.slice(0, 8)).toEqual(Array.from({ length: 8 }, (_, at) => `${at + 1}.1`));
    expect(long.slice(8, 16)).toEqual(Array.from({ length: 8 }, (_, at) => `${at + 1}.2`));
    // 第二段 5 首：左栏 3、右栏 2，接在第 8 行下面。
    expect(long.slice(16)).toEqual(['9.1', '10.1', '11.1', '9.2', '10.2']);
  });
});

describe('插进条目流', () => {
  it('插在那张专辑所在行的后面，箭头指它所在的列；占的高是面板高加一个行间距', () => {
    const items = withDropdowns(flow(2), [place(b)], GAP);
    expect(shape(items)).toEqual(['h:Jazz', 'AB', 'v:B@1', 'C', 'h:Rock', 'DE']);
    const dropdown = items[2];
    expect(dropdown?.kind === 'dropdown' && dropdown.size).toBe(300 + GAP);
    expect(dropdown?.kind === 'dropdown' && dropdown.sectionKey).toBe('Jazz');
  });

  it('列数变了：跟着那张专辑挂到它新的所在行后面', () => {
    expect(shape(withDropdowns(flow(2), [place(c)], GAP))).toEqual([
      'h:Jazz',
      'AB',
      'C',
      'v:C@0',
      'h:Rock',
      'DE',
    ]);
    expect(shape(withDropdowns(flow(3), [place(c)], GAP))).toEqual([
      'h:Jazz',
      'ABC',
      'v:C@2',
      'h:Rock',
      'DE',
    ]);
  });

  it('换行时新旧两条同在；同一行只挂排在前面的那条', () => {
    expect(shape(withDropdowns(flow(2), [place(d, 2), place(a, 1)], GAP))).toEqual([
      'h:Jazz',
      'AB',
      'v:A@0',
      'C',
      'h:Rock',
      'DE',
      'v:D@0',
    ]);
    expect(shape(withDropdowns(flow(2), [place(b, 2), place(a, 1)], GAP))).toEqual([
      'h:Jazz',
      'AB',
      'v:B@1',
      'C',
      'h:Rock',
      'DE',
    ]);
  });

  it('专辑被折叠、被过滤掉或不在清单里时不插', () => {
    const folded = buildGridItems(sections, new Set(['Rock']), 2, {
      headers: true,
      repeats: false,
    });
    expect(shape(withDropdowns(folded, [place(d)], GAP))).toEqual(shape(folded));
    expect(shape(withDropdowns(flow(2), [place(albumRow('Z', 'X'))], GAP))).toEqual(shape(flow(2)));
  });

  it('同一张在几节里各有一块：先挂被点那一节的，那一节没有再挂第一块', () => {
    const repeated: AlbumSection[] = [
      { key: 'X', albums: [a, b] },
      { key: 'Y', albums: [c, b] },
    ];
    const items = buildGridItems(repeated, new Set(), 2, { headers: true, repeats: true });
    expect(rowHolding(items, albumKeyOf(b), 'Y')).toMatchObject({ index: 3, column: 1 });
    expect(rowHolding(items, albumKeyOf(b), 'Z')).toMatchObject({ index: 1, column: 1 });
    expect(shape(withDropdowns(items, [place(b, 1, 300, 'Y')], GAP))).toEqual([
      'h:X',
      'AB',
      'h:Y',
      'CB',
      'v:B@1',
    ]);
  });

  it('没有下拉时照抄一份，不改入参', () => {
    const items = flow(2);
    const copy = withDropdowns(items, [], GAP);
    expect(copy).toEqual(items);
    expect(copy).not.toBe(items);
  });
});

describe('条目的高与上沿', () => {
  it('图块行、节头与下拉各按自己的高；上沿逐项累加，末尾多一项是总高', () => {
    const items = withDropdowns(flow(2), [place(b)], GAP);
    const sizeOf = (item: GridItem) => flowItemSize(item, 200, 32);
    expect(items.map(sizeOf)).toEqual([32, 200, 312, 200, 32, 200]);
    expect(itemTops(items, sizeOf)).toEqual([0, 32, 232, 544, 744, 776, 976]);
  });
});

describe('展开时的滚动目标', () => {
  const base = { viewport: 600, gap: GAP, maxScroll: 5000 };

  it('行与下拉都放得下、底下还留一个行间距：不滚', () => {
    expect(scrollTargetFor({ ...base, scrollTop: 100, rowTop: 200, dropdownBottom: 688 })).toBe(
      100,
    );
  });

  it('放不下：滚到下拉底边连同行间距贴视口底边', () => {
    expect(scrollTargetFor({ ...base, scrollTop: 100, rowTop: 400, dropdownBottom: 900 })).toBe(
      900 + GAP - 600,
    );
  });

  it('行加下拉比视口还高：行顶贴视口顶，不让行顶滚出视口', () => {
    expect(scrollTargetFor({ ...base, scrollTop: 100, rowTop: 400, dropdownBottom: 1300 })).toBe(
      400,
    );
  });

  it('行顶在视口上面：往上滚到行顶露出来为止', () => {
    expect(scrollTargetFor({ ...base, scrollTop: 500, rowTop: 450, dropdownBottom: 800 })).toBe(
      450,
    );
  });

  it('夹在 0 与动画结束后能滚到的最低处之间', () => {
    expect(
      scrollTargetFor({
        ...base,
        scrollTop: 100,
        rowTop: 400,
        dropdownBottom: 900,
        maxScroll: 250,
      }),
    ).toBe(250);
    expect(
      scrollTargetFor({ ...base, scrollTop: 100, rowTop: 400, dropdownBottom: 900, maxScroll: -5 }),
    ).toBe(0);
  });
});
