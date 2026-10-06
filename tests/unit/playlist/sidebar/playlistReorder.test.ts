import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD,
  edgeStep,
  hostOrder,
  isOwnSlot,
  landingIndex,
  moveOrder,
  passedThreshold,
  slotAt,
  stepSlot,
} from '../../../../src/playlist/sidebar/playlistReorder.ts';

describe('playlist reorder', () => {
  it(`移出 ${DRAG_THRESHOLD} 像素以上才算拖`, () => {
    expect(passedThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
    expect(passedThreshold({ x: 0, y: 0 }, { x: 3, y: 5 })).toBe(true);
  });

  it('插入位按行的上下半定：上半插在它之前，末行之下是末尾', () => {
    const rows = [
      { top: 0, bottom: 32 },
      { top: 34, bottom: 66 },
      { top: 68, bottom: 100 },
    ];
    expect(slotAt(-5, rows)).toBe(0);
    expect(slotAt(10, rows)).toBe(0);
    expect(slotAt(20, rows)).toBe(1);
    expect(slotAt(90, rows)).toBe(3);
    expect(slotAt(200, rows)).toBe(3);
  });

  it('完整排列：第 i 位放原来的第几张；原位与越界不发', () => {
    expect(moveOrder(4, 0, 3)).toEqual([1, 2, 0, 3]);
    expect(moveOrder(4, 3, 0)).toEqual([3, 0, 1, 2]);
    expect(moveOrder(4, 1, 4)).toEqual([0, 2, 3, 1]);
    expect(moveOrder(4, 1, 1)).toBeNull();
    expect(moveOrder(4, 1, 2)).toBeNull();
    expect(moveOrder(4, 5, 0)).toBeNull();
    expect(moveOrder(4, 0, 5)).toBeNull();
  });

  it('换成宿主的排列：清单外的几张留在原序号上，清单里的按排列填进其余的格', () => {
    // 宿主 [Q, A, buf, B, C]，清单是 A、B、C（序号 1、3、4），把 C 挪到最前。
    expect(hostOrder([2, 0, 1], [1, 3, 4], 5)).toEqual([0, 4, 2, 1, 3]);
    expect(hostOrder([1, 0, 2], [0, 1, 2], 3)).toEqual([1, 0, 2]);
  });

  it('原位判定与挪完的新序号', () => {
    expect(isOwnSlot(2, 2)).toBe(true);
    expect(isOwnSlot(2, 3)).toBe(true);
    expect(isOwnSlot(2, 1)).toBe(false);
    expect(landingIndex(1, 4)).toBe(3);
    expect(landingIndex(3, 0)).toBe(0);
  });

  it('Alt+↑ / Alt+↓ 各挪一位，到头不动', () => {
    expect(stepSlot(0, -1, 3)).toBeNull();
    expect(stepSlot(1, -1, 3)).toBe(0);
    expect(stepSlot(1, 1, 3)).toBe(3);
    expect(stepSlot(2, 1, 3)).toBeNull();
    expect(moveOrder(3, 1, stepSlot(1, 1, 3) ?? -1)).toEqual([0, 2, 1]);
  });

  it('拖到边缘往哪滚：离上下沿不到一行高就滚', () => {
    expect(edgeStep(105, 100, 400, 32)).toBe(-1);
    expect(edgeStep(50, 100, 400, 32)).toBe(-1);
    expect(edgeStep(250, 100, 400, 32)).toBe(0);
    expect(edgeStep(390, 100, 400, 32)).toBe(1);
  });
});
