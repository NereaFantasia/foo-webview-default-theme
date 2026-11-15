import { describe, expect, it } from 'vitest';
import {
  BLEED_MIN_SIZE,
  COLUMN_TOP,
  DEFAULT_LAYOUT_OPTIONS,
  bleedLayoutOf,
  coverRequestSize,
} from '../../../../src/immersive/presets/bleed/bleedLayout.ts';

// 满幅封面的版式数值：封面宽 0.58、右栏从一半起、胶囊居中在左半区；居中时封面与胶囊一起移到窗口正中

describe('bleedLayoutOf：1280 × 800（画稿基准）', () => {
  const box = { width: 1280, height: 800 };

  it('常规：封面贴左、宽 742，右栏从 640 起，胶囊 440 宽居中在左半区', () => {
    expect(bleedLayoutOf(box, false)).toEqual({
      coverWidth: 742,
      coverLeft: 0,
      sideLeft: 640,
      capsuleWidth: 440,
      capsuleLeft: 100,
      columnTop: 80,
      columnHeight: 684,
    });
  });

  it('居中：封面尺寸不变、移到正中，胶囊居中在窗口正中，右栏起点不动', () => {
    const centered = bleedLayoutOf(box, true);
    expect(centered.coverWidth).toBe(742);
    expect(centered.coverLeft).toBe(269);
    expect(centered.capsuleLeft).toBe(420);
    expect(centered.sideLeft).toBe(640);
  });
});

describe('bleedLayoutOf：最小尺寸 960 × 600', () => {
  const { width, height } = BLEED_MIN_SIZE;

  it('胶囊收到半区宽减两边各 24，封面右侧的 8% 压在右栏底下', () => {
    const layout = bleedLayoutOf({ width, height }, false);
    expect(layout.capsuleWidth).toBe(432);
    expect(layout.capsuleLeft).toBe(24);
    expect(layout.coverWidth).toBe(557);
    expect(layout.coverLeft + layout.coverWidth).toBeGreaterThan(layout.sideLeft);
  });

  it('队列、历史的列上沿 80，下沿与胶囊底对齐（离窗底 36）', () => {
    const layout = bleedLayoutOf({ width, height }, false);
    expect(layout.columnTop).toBe(COLUMN_TOP);
    expect(layout.columnTop + layout.columnHeight).toBe(height - 36);
  });
});

describe('bleedLayoutOf：各种窗口下的不变量', () => {
  const sizes = [
    { width: 960, height: 600 },
    { width: 1111, height: 703 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
    { width: 3440, height: 1440 },
  ];

  it('每个数都是整数，免得静止时文字落在半个像素上', () => {
    for (const box of sizes)
      for (const centered of [false, true])
        for (const value of Object.values(bleedLayoutOf(box, centered)))
          expect(Number.isInteger(value), `${box.width}×${box.height} 居中${centered}`).toBe(true);
  });

  it('胶囊不超宽上限，常规时整个落在右栏起点的左边，居中时整个在窗口里', () => {
    for (const box of sizes) {
      const regular = bleedLayoutOf(box, false);
      expect(regular.capsuleWidth).toBeLessThanOrEqual(DEFAULT_LAYOUT_OPTIONS.capsuleWidth);
      expect(regular.capsuleLeft).toBeGreaterThanOrEqual(0);
      expect(regular.capsuleLeft + regular.capsuleWidth).toBeLessThanOrEqual(regular.sideLeft);
      const centered = bleedLayoutOf(box, true);
      expect(centered.capsuleLeft + centered.capsuleWidth).toBeLessThanOrEqual(box.width);
      expect(centered.coverLeft + centered.coverWidth).toBeLessThanOrEqual(box.width);
    }
  });

  it('居中时封面左右对称', () => {
    for (const box of sizes) {
      const { coverLeft, coverWidth } = bleedLayoutOf(box, true);
      expect(Math.abs(coverLeft - (box.width - coverLeft - coverWidth))).toBeLessThanOrEqual(1);
    }
  });
});

describe('bleedLayoutOf：用户调的几项', () => {
  const box = { width: 1280, height: 800 };

  it('缺省的选项就是画稿基准，不给选项等于给缺省', () => {
    expect(bleedLayoutOf(box, false, DEFAULT_LAYOUT_OPTIONS)).toEqual(bleedLayoutOf(box, false));
  });

  it('封面宽度、右栏起点按窗宽的百分数走，胶囊跟着右栏起点居中在左半区', () => {
    const layout = bleedLayoutOf(box, false, {
      ...DEFAULT_LAYOUT_OPTIONS,
      coverWidth: 65,
      sideStart: 54,
    });
    expect(layout.coverWidth).toBe(832);
    expect(layout.sideLeft).toBe(691);
    expect(layout.capsuleLeft).toBe(Math.round(691 / 2 - 440 / 2));
  });

  it('封面往左伸出窗外：左缘是负的，尺寸不变；居中时不管这一项', () => {
    const shifted = bleedLayoutOf(box, false, { ...DEFAULT_LAYOUT_OPTIONS, coverShift: 10 });
    expect(shifted.coverLeft).toBe(-128);
    expect(shifted.coverWidth).toBe(742);
    const centered = bleedLayoutOf(box, true, { ...DEFAULT_LAYOUT_OPTIONS, coverShift: 10 });
    expect(centered.coverLeft).toBe(269);
  });

  it('胶囊宽度是上限：半区放不下时仍收到半区宽减两边各 24；底边跟着队列页的列下沿', () => {
    const wide = bleedLayoutOf(box, false, { ...DEFAULT_LAYOUT_OPTIONS, capsuleWidth: 520 });
    expect(wide.capsuleWidth).toBe(520);
    const narrow = bleedLayoutOf({ width: 960, height: 600 }, false, {
      ...DEFAULT_LAYOUT_OPTIONS,
      capsuleWidth: 520,
    });
    expect(narrow.capsuleWidth).toBe(432);
    const raised = bleedLayoutOf(box, false, { ...DEFAULT_LAYOUT_OPTIONS, capsuleBottom: 64 });
    expect(raised.columnTop + raised.columnHeight).toBe(800 - 64);
  });
});

describe('coverRequestSize：满幅封面向宿主要多大的图', () => {
  const layout = bleedLayoutOf({ width: 1280, height: 800 }, false);

  it('按封面显示的长边（含缩放）乘像素比，向上取到 128，最大到宿主上限 2048', () => {
    expect(coverRequestSize(layout, 800, 100, 1)).toBe(896);
    expect(coverRequestSize(layout, 800, 100, 1.5)).toBe(1280);
    expect(coverRequestSize(layout, 800, 150, 1.5)).toBe(1920);
    expect(coverRequestSize(layout, 1440, 150, 2)).toBe(2048);
  });

  it('比共用封面的 512 档大：这一档存在就是为了不发软', () => {
    expect(coverRequestSize(layout, 800, 100, 1)).toBeGreaterThan(512);
  });
});
