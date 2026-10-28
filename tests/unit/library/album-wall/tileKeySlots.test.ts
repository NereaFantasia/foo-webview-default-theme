import { describe, expect, it } from 'vitest';
import type { PlacedTile } from '../../../../src/library/album-wall/albumGridLayout.ts';
import {
  NO_KEY_SLOTS,
  nextKeySlots,
  type KeySlots,
} from '../../../../src/library/album-wall/tileKeySlots.ts';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

function tile(name: string, x = 0, y = 0): PlacedTile {
  const album = albumRow(name, 'X');
  const key = albumKeyOf(album);
  return { key, albumKey: key, sectionKey: null, album, index: 0, column: 0, x, y };
}

const A = tile('A');
const B = tile('B', 180);
const C = tile('C', 360);

function after(...hovers: (PlacedTile | undefined)[]): KeySlots {
  return hovers.reduce(nextKeySlots, NO_KEY_SLOTS);
}

describe('nextKeySlots', () => {
  it('从没悬停过、指针又不在图块上：原样不动', () => {
    expect(nextKeySlots(NO_KEY_SLOTS, undefined)).toBe(NO_KEY_SLOTS);
  });

  it('第一次悬停落在槽 0，可见', () => {
    expect(after(A)).toEqual({ tiles: [A, undefined], current: 0, visible: true });
  });

  it('同一块、同一位置再算一次：原对象，渲染里不必更新状态', () => {
    const slots = after(A);
    expect(nextKeySlots(slots, A)).toBe(slots);
    expect(nextKeySlots(slots, { ...A })).toBe(slots);
  });

  it('同一块换了位置（换列、滚动）：仍在原槽，位置更新', () => {
    const moved = tile('A', 40, 90);
    expect(after(A, moved)).toEqual({ tiles: [moved, undefined], current: 0, visible: true });
  });

  it('换到另一块：新的一块占另一个槽，上一块留在原槽淡出', () => {
    expect(after(A, B)).toEqual({ tiles: [A, B], current: 1, visible: true });
  });

  it('指针离开：两个槽的图块都留着，当前槽不再可见', () => {
    const left = after(A, B, undefined);
    expect(left).toEqual({ tiles: [A, B], current: 1, visible: false });
    expect(nextKeySlots(left, undefined)).toBe(left);
  });

  it('回到还留在槽里的那一块：沿用它的槽，不占另一个', () => {
    expect(after(A, B, undefined, A)).toEqual({ tiles: [A, B], current: 0, visible: true });
    expect(after(A, B, A)).toEqual({ tiles: [A, B], current: 0, visible: true });
  });

  it('连着换三块：第三块顶掉不在当前槽的那一块', () => {
    expect(after(A, B, C)).toEqual({ tiles: [C, B], current: 0, visible: true });
  });
});
