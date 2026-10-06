import { describe, expect, it } from 'vitest';
import {
  cornerOf,
  offScreen,
  placeBox,
  type Edges,
  type ScreenView,
} from '../../../src/host/miniPlacement.ts';

const WORK: Edges = { left: 0, top: 0, right: 1920, bottom: 1040 };

function view(left: number, top: number, width: number, height: number, work = WORK): ScreenView {
  return { window: { left, top, right: left + width, bottom: top + height }, work };
}

describe('迷你窗口贴哪一角', () => {
  it('离哪条边近就贴哪条', () => {
    expect(cornerOf(view(20, 30, 333, 133))).toEqual({ vertical: 'top', horizontal: 'left' });
    expect(cornerOf(view(1500, 880, 333, 133))).toEqual({
      vertical: 'bottom',
      horizontal: 'right',
    });
    expect(cornerOf(view(40, 900, 333, 133))).toEqual({ vertical: 'bottom', horizontal: 'left' });
  });
});

describe('换尺寸后的位置', () => {
  it('贴着的那一角不动，窗口朝另外两边伸缩', () => {
    const current = { x: 1500, y: 880, width: 333, height: 133 };
    const corner = { vertical: 'bottom', horizontal: 'right' } as const;
    expect(placeBox(current, 280, 399, corner, view(1500, 880, 333, 133), 1)).toEqual({
      x: 1553,
      y: 614,
    });
  });

  it('越出工作区时推回来，挪动距离按像素比换算', () => {
    const work = { left: 0, top: 0, right: 1280, bottom: 200 };
    const current = { x: 120, y: 120, width: 500, height: 200 };
    const corner = { vertical: 'top', horizontal: 'left' } as const;
    // 浏览器坐标里窗口在 (60, 60)、高 100；长到 160 后下沿越出 20，物理像素要上移 40。
    expect(placeBox(current, 500, 320, corner, view(60, 60, 250, 100, work), 2)).toEqual({
      x: 120,
      y: 80,
    });
  });

  it('比工作区还大时贴住工作区的左上角', () => {
    const work = { left: 100, top: 50, right: 400, bottom: 250 };
    const current = { x: 200, y: 100, width: 100, height: 100 };
    const corner = { vertical: 'bottom', horizontal: 'right' } as const;
    expect(placeBox(current, 500, 300, corner, view(200, 100, 100, 100, work), 1)).toEqual({
      x: 100,
      y: 50,
    });
  });
});

describe('窗口是否还在屏幕上', () => {
  it('与工作区有一点重叠就算在', () => {
    expect(offScreen(view(1900, 1000, 333, 133))).toBe(false);
    expect(offScreen(view(1920, 100, 333, 133))).toBe(true);
    expect(offScreen(view(100, -133, 333, 133))).toBe(true);
  });
});
