import { describe, expect, it } from 'vitest';
import {
  albumAt,
  findGridPrefix,
  moveInGrid,
  resolveGridKey,
} from '../../../../src/library/album-wall/albumGridKeys.ts';
import { buildGridItems } from '../../../../src/library/album-wall/albumGridLayout.ts';
import type { AlbumSection } from '../../../../src/library/albumSections.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

const [a, b, c, d, e, f] = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Echo', 'Foxtrot'].map((name) =>
  albumRow(name, `${name} Band`),
);
const sections: AlbumSection[] = [
  { key: 'Jazz', albums: [a!, b!, c!] },
  { key: 'Rock', albums: [d!, e!] },
  { key: 'Soul', albums: [f!] },
];
// 0 节头 Jazz、1 [A B]、2 [C]、3 节头 Rock、4 [D E]、5 节头 Soul、6 [F]
const items = buildGridItems(sections, new Set(), 2, { headers: true, repeats: false });

describe('moveInGrid', () => {
  it('还没有落点时任何移动键落到第一块', () => {
    expect(moveInGrid(items, undefined, 'ArrowDown', 3)).toEqual({ index: 1, column: 0 });
  });

  it('左右逐块走，行尾接下一行、节尾接下一节', () => {
    expect(moveInGrid(items, { index: 1, column: 1 }, 'ArrowRight', 3)).toEqual({
      index: 2,
      column: 0,
    });
    expect(moveInGrid(items, { index: 2, column: 0 }, 'ArrowRight', 3)).toEqual({
      index: 4,
      column: 0,
    });
    expect(moveInGrid(items, { index: 4, column: 0 }, 'ArrowLeft', 3)).toEqual({
      index: 2,
      column: 0,
    });
  });

  it('上下同一列走、跳过节头；跨到短行时落在行尾那块', () => {
    const down = moveInGrid(items, { index: 1, column: 1 }, 'ArrowDown', 3);
    expect(down).toEqual({ index: 2, column: 0 });
    expect(albumAt(items, down)).toBe(c);
    expect(albumAt(items, { index: 2, column: 5 })).toBe(c);
    expect(moveInGrid(items, { index: 4, column: 1 }, 'ArrowUp', 3)).toEqual({
      index: 2,
      column: 0,
    });
  });

  it('翻页按一屏的行数跳，到头停住；Home、End 到首块与末块', () => {
    expect(moveInGrid(items, { index: 1, column: 0 }, 'PageDown', 2)).toEqual({
      index: 4,
      column: 0,
    });
    expect(moveInGrid(items, { index: 4, column: 0 }, 'PageDown', 9)).toEqual({
      index: 6,
      column: 0,
    });
    expect(moveInGrid(items, { index: 4, column: 1 }, 'Home', 2)).toEqual({ index: 1, column: 0 });
    expect(moveInGrid(items, { index: 1, column: 0 }, 'End', 2)).toEqual({ index: 6, column: 0 });
  });

  it('已在尽头或不是移动键时为 undefined', () => {
    expect(moveInGrid(items, { index: 6, column: 0 }, 'ArrowDown', 3)).toBeUndefined();
    expect(moveInGrid(items, { index: 1, column: 0 }, 'ArrowLeft', 3)).toBeUndefined();
    expect(moveInGrid(items, { index: 1, column: 0 }, 'x', 3)).toBeUndefined();
  });
});

describe('resolveGridKey', () => {
  it('回车在有落点时播放，没有落点不管', () => {
    expect(resolveGridKey(items, { index: 4, column: 1 }, 'Enter', 3)).toEqual({
      kind: 'play',
      album: e,
    });
    expect(resolveGridKey(items, undefined, 'Enter', 3)).toEqual({ kind: 'none' });
  });

  it('移动键算得出就给落点与专辑，到头也拦下', () => {
    expect(resolveGridKey(items, { index: 1, column: 0 }, 'ArrowRight', 3)).toEqual({
      kind: 'move',
      next: { index: 1, column: 1 },
      album: b,
    });
    expect(resolveGridKey(items, { index: 6, column: 0 }, 'End', 3)).toEqual({ kind: 'block' });
    expect(resolveGridKey(items, { index: 1, column: 0 }, 'Tab', 3)).toEqual({ kind: 'none' });
  });
});

describe('findGridPrefix', () => {
  it('节头命中：滚到节头，焦点落在它下面第一块；节头优先于专辑名，专辑名优先于专辑艺术家', () => {
    expect(findGridPrefix(items, { index: 1, column: 0 }, 'ro')).toEqual({
      index: 3,
      at: { index: 4, column: 0 },
      album: d,
    });
    expect(findGridPrefix(items, { index: 1, column: 0 }, 'ga')).toEqual({
      index: 2,
      at: { index: 2, column: 0 },
      album: c,
    });
    expect(findGridPrefix(items, { index: 1, column: 0 }, 'echo b')?.album).toBe(e);
  });

  it('从焦点那一块含它自己起找，到头绕回；不分大小写', () => {
    expect(findGridPrefix(items, { index: 4, column: 0 }, 'ALPHA')?.at).toEqual({
      index: 1,
      column: 0,
    });
    expect(findGridPrefix(items, { index: 4, column: 0 }, 'd')?.album).toBe(d);
    expect(findGridPrefix(items, undefined, 'b')?.album).toBe(b);
  });

  it('同一行里从焦点那一块往后找，不从行首找', () => {
    const [abba, moon, abbey] = ['Abba', 'Moon', 'Abbey'].map((name) => albumRow(name, 'Z'));
    const row = buildGridItems([{ key: null, albums: [abba!, moon!, abbey!] }], new Set(), 3, {
      headers: false,
      repeats: false,
    });
    expect(findGridPrefix(row, { index: 0, column: 1 }, 'ab')).toEqual({
      index: 0,
      at: { index: 0, column: 2 },
      album: abbey,
    });
    expect(findGridPrefix(row, { index: 0, column: 2 }, 'abba')?.at).toEqual({
      index: 0,
      column: 0,
    });
  });

  describe('焦点所在那一节的节头算焦点自己', () => {
    const [j, r1, r2, r3, r4, rr] = ['J', 'R1', 'R2', 'R3', 'R4', 'RR'].map((name) =>
      albumRow(name, 'Z'),
    );
    // 0 节头 Jazz、1 [J]、2 节头 Rock、3 [R1 R2]、4 [R3 R4]、5 节头 Rock and Roll、6 [RR]
    const nested = buildGridItems(
      [
        { key: 'Jazz', albums: [j!] },
        { key: 'Rock', albums: [r1!, r2!, r3!, r4!] },
        { key: 'Rock and Roll', albums: [rr!] },
      ],
      new Set(),
      2,
      { headers: true, repeats: false },
    );

    it('打「ro」跳到 Rock 之后接着打「roc」，留在原地', () => {
      const first = findGridPrefix(nested, { index: 1, column: 0 }, 'ro');
      expect(first).toEqual({ index: 2, at: { index: 3, column: 0 }, album: r1 });
      expect(findGridPrefix(nested, first?.at, 'roc')).toEqual(first);
    });

    it('在一节深处打出这一节的名字，回到这一节的第一块', () => {
      expect(findGridPrefix(nested, { index: 4, column: 1 }, 'rock')).toEqual({
        index: 2,
        at: { index: 3, column: 0 },
        album: r1,
      });
      expect(findGridPrefix(nested, { index: 4, column: 1 }, 'rock ')?.album).toBe(rr);
    });
  });

  it('折叠的节头不算命中；没有命中为 undefined', () => {
    const folded = buildGridItems(sections, new Set(['Soul']), 2, {
      headers: true,
      repeats: false,
    });
    expect(findGridPrefix(folded, undefined, 'soul')).toBeUndefined();
    expect(findGridPrefix(items, undefined, 'zz')).toBeUndefined();
  });
});
