import { describe, expect, it } from 'vitest';
import {
  COLUMN_EDGE,
  COVER_MIN,
  columnReachOf,
  coverSizeOf,
  fitScale,
  gapsOf,
  isCompact,
  keyBoxOf,
  keyRowOf,
  keySizeOf,
  layoutBox,
  sidebarFits,
  sizeOf,
  stackOf,
} from '../../../../src/immersive/presets/split/splitLayout.ts';

describe('coverSizeOf', () => {
  it('1280 × 800 是 400，960 × 600 是 294，照画稿', () => {
    expect(coverSizeOf({ width: 1280, height: 800 })).toBe(400);
    expect(coverSizeOf({ width: 960, height: 600 })).toBe(294);
  });

  it('三个量取小：宽窗被高度卡住，窄窗被宽度卡住', () => {
    expect(coverSizeOf({ width: 3000, height: 600 })).toBe(294);
    expect(coverSizeOf({ width: 700, height: 2000 })).toBe(266);
  });

  it('不小于 160，结果是整数', () => {
    expect(coverSizeOf({ width: 400, height: 364 })).toBe(COVER_MIN);
    expect(coverSizeOf({ width: 100, height: 100 })).toBe(COVER_MIN);
    expect(Number.isInteger(coverSizeOf({ width: 1111, height: 777 }))).toBe(true);
  });
});

describe('档位与压缩', () => {
  it('窗高 800 取 large，600 取 medium，不到 466 取 small 且压缩', () => {
    expect(sizeOf(800)).toBe('large');
    expect(sizeOf(600)).toBe('medium');
    expect(sizeOf(466)).toBe('medium');
    expect(sizeOf(465)).toBe('small');
    expect(isCompact(466)).toBe(false);
    expect(isCompact(465)).toBe(true);
  });

  it('间隔扣掉进度命中区的 8：平时 24、12、8，压缩时 16、4、0；键 40 与 36', () => {
    expect(gapsOf(800)).toEqual({ cover: 24, info: 12, keys: 8 });
    expect(gapsOf(400)).toEqual({ cover: 16, info: 4, keys: 0 });
    expect(keyBoxOf(800)).toBe(40);
    expect(keyBoxOf(400)).toBe(36);
  });
});

describe('keyRowOf', () => {
  it('封面 216 以上五个键都在，176 到 216 收播放顺序，160 到 176 再去掉音量前的间隔', () => {
    expect(keyRowOf(400)).toEqual({ order: true, volumeGap: true });
    expect(keyRowOf(216)).toEqual({ order: true, volumeGap: true });
    expect(keyRowOf(215)).toEqual({ order: false, volumeGap: true });
    expect(keyRowOf(176)).toEqual({ order: false, volumeGap: true });
    expect(keyRowOf(175)).toEqual({ order: false, volumeGap: false });
    expect(keyRowOf(160)).toEqual({ order: false, volumeGap: false });
  });
});

describe('keySizeOf', () => {
  it('窗高够大且封面放得下五个大键才放大：800 高封面 400 是 large，960 × 600 的 294 仍是 regular', () => {
    expect(keySizeOf(800, 400)).toBe('large');
    expect(keySizeOf(700, 256)).toBe('large');
    expect(keySizeOf(600, 294), '中档窗高被列内固定高度卡着，不放大').toBe('regular');
    expect(keySizeOf(699, 400)).toBe('regular');
  });

  it('封面不到 256 放不下五个大键：回到 regular；窗高不到 466 永远是 compact', () => {
    expect(keySizeOf(800, 255)).toBe('regular');
    expect(keySizeOf(800, 160)).toBe('regular');
    expect(keySizeOf(465, 400)).toBe('compact');
    expect(keySizeOf(364, 160)).toBe('compact');
  });
});

describe('整体等比缩小与侧栏', () => {
  it('不小于 400 × 364 时不缩', () => {
    expect(fitScale({ width: 1280, height: 800 })).toBe(1);
    expect(fitScale({ width: 400, height: 364 })).toBe(1);
  });

  it('更小时按 min(宽 ÷ 400，高 ÷ 364) 缩', () => {
    expect(fitScale({ width: 320, height: 240 })).toBeCloseTo(240 / 364, 6);
    expect(fitScale({ width: 200, height: 800 })).toBeCloseTo(0.5, 6);
    expect(fitScale({ width: 0, height: 0 })).toBe(1);
  });

  it('缩小后排版尺寸是反过来放大的，不小于最小尺寸', () => {
    const box = layoutBox({ width: 320, height: 240 });
    expect(box.height).toBeCloseTo(364, 6);
    expect(box.width).toBeGreaterThanOrEqual(400);
  });

  it('侧栏放得下按缩放后的窗宽判：不到 700 退居中', () => {
    expect(sidebarFits({ width: 1280, height: 800 })).toBe(true);
    expect(sidebarFits({ width: 700, height: 600 })).toBe(true);
    expect(sidebarFits({ width: 699, height: 600 })).toBe(false);
    expect(sidebarFits({ width: 400, height: 364 })).toBe(false);
  });
});

describe('columnReachOf', () => {
  it('封面列的居中范围多算 0.05 倍窗宽，到窗口正中线', () => {
    expect(columnReachOf({ width: 1280 })).toBe(64);
    expect(columnReachOf({ width: 1920 })).toBe(96);
    // 0.45 栏加上它正好是窗宽的一半
    for (const width of [960, 1280, 1696, 2120])
      expect(Math.abs(0.45 * width + columnReachOf({ width }) - width / 2)).toBeLessThanOrEqual(
        0.5,
      );
  });
});

describe('stackOf', () => {
  it('1280 × 800：封面 400，信息行 58，进度 44，大键 48，整组 594 高、上沿 103', () => {
    expect(stackOf({ width: 1280, height: 800 })).toEqual({
      cover: 400,
      rows: { info: 58, progress: 44, keys: 48 },
      top: 103,
      height: 594,
    });
  });

  it('960 × 600：封面 294，信息行 49，键 40，整组 471 高、上沿取整为 65', () => {
    expect(stackOf({ width: 960, height: 600 })).toEqual({
      cover: 294,
      rows: { info: 49, progress: 44, keys: 40 },
      top: 65,
      height: 471,
    });
  });

  it('压缩档：行高与键跟着缩，信息行不小于更多键', () => {
    const stack = stackOf({ width: 400, height: 364 });
    expect(stack.rows).toEqual({ info: 44, progress: 44, keys: 36 });
    expect(stack.height).toBe(304);
  });

  it('整组高是各块加间隔，上沿至少让开控制层，窗口再矮也不上移', () => {
    for (const [width, height] of [
      [1280, 800],
      [960, 600],
      [800, 466],
      [700, 465],
      [400, 364],
    ] as const) {
      const stack = stackOf({ width, height });
      const gaps = gapsOf(height);
      expect(stack.height).toBe(
        stack.cover +
          gaps.cover +
          stack.rows.info +
          gaps.info +
          stack.rows.progress +
          gaps.keys +
          stack.rows.keys,
      );
      expect(stack.top).toBeGreaterThanOrEqual(COLUMN_EDGE);
      expect(Number.isInteger(stack.top)).toBe(true);
    }
    expect(stackOf({ width: 400, height: 364 }).top).toBe(COLUMN_EDGE);
  });
});
