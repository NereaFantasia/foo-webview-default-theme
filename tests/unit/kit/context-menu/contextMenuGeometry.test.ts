import { describe, expect, it } from 'vitest';
import {
  contextMenuBounds,
  contextMenuCascadeWidth,
} from '../../../../src/kit/context-menu/contextMenuGeometry.ts';

describe('菜单可用区域', () => {
  it('按完整客户区限制长宽，不只取落点下方', () => {
    expect(contextMenuBounds({ width: 1280, height: 800, left: 0, top: 0 }, 12)).toEqual({
      width: 420,
      height: 600,
    });
    expect(contextMenuBounds({ width: 390, height: 320, left: 0, top: 0 }, 12)).toEqual({
      width: 366,
      height: 296,
    });
  });
  it('两侧都不足一列时改为同层，靠边仍能向另一侧展开', () => {
    const viewport = { width: 800, height: 600, left: 0, top: 0 };
    expect(contextMenuCascadeWidth({ left: 250, right: 550 }, viewport, 12, 4)).toBe(234);
    expect(contextMenuCascadeWidth({ left: 480, right: 780 }, viewport, 12, 4)).toBe(420);
  });
  it('处理缩放后的偏移和极小区域，不产生负尺寸', () => {
    expect(
      contextMenuCascadeWidth(
        { left: 100, right: 400 },
        { width: 390, height: 300, left: 100, top: 20 },
        12,
        4,
      ),
    ).toBe(74);
    expect(contextMenuBounds({ width: 20, height: 10, left: 0, top: 0 }, 12)).toEqual({
      width: 0,
      height: 0,
    });
  });
});
