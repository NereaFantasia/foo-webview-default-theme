import { describe, expect, test } from 'vitest';
import { SHEET_ARCS } from '../../../../src/immersive/decor/paperDecor.ts';
import {
  STAGE_ARCS,
  STAGE_CROSSES,
  STAGE_PAD,
} from '../../../../src/immersive/paper/paperStage.ts';
import {
  COMPACT_SCALE,
  paperGeometry,
  paperTier,
  PORTRAIT_NARROW_HEIGHT,
} from '../../../../src/immersive/paper/paperTiers.ts';

/**
 * 图纸的六档：竖版三档先判，横版 full（舞台）/ compact / narrow；每档的内容层、罗盘、右栏与三段弧。
 */
describe('paperTiers', () => {
  test('paperTier：竖版三档先判，其余按 full → compact → narrow 落档', () => {
    const cases: [number, number, string][] = [
      [1280, 800, 'full'],
      [1920, 1080, 'full'],
      [1366, 720, 'full'],
      [1280, 720, 'full'],
      [1279, 720, 'compact'],
      [1280, 719, 'compact'],
      [1200, 720, 'compact'],
      [900, 700, 'compact'],
      [1000, 900, 'compact'],
      [899, 700, 'narrow'],
      [1920, 650, 'narrow'],
      [900, 600, 'narrow'],
      [390, 700, 'narrow'],
      [864, 1536, 'portrait'],
      [720, 1280, 'portrait-compact'],
      [700, 1300, 'portrait-compact'],
      [800, 1100, 'portrait-narrow'],
      [700, 1000, 'portrait-narrow'],
      [640, 1239, 'portrait-narrow'],
      [700, 999, 'narrow'],
      [639, 1100, 'narrow'],
      [600, 1600, 'narrow'],
    ];
    for (const [width, height, tier] of cases) {
      expect(paperTier(width, height), `${width} × ${height}`).toBe(tier);
    }
  });

  test('full：1920 × 1080 的舞台按宽高较小的比值等比缩放、居中；十字、垫纸与弧取舞台常量', () => {
    const wide = paperGeometry(2560, 1080);
    expect(wide.sheet).toStrictEqual({ width: 1920, height: 1080 });
    expect(wide.scale).toBe(1);
    expect(wide.origin).toStrictEqual({ x: 320, y: 0 });
    expect(wide.dial).toStrictEqual({ x: 380, y: 512, scale: 1, transportOffset: 412 });
    expect(wide.arcs).toStrictEqual(STAGE_ARCS);
    expect(wide.crosses).toStrictEqual(STAGE_CROSSES);
    expect(wide.pad).toStrictEqual(STAGE_PAD);
    expect(wide.sunkTerrain).toBe(false);
    const floor = paperGeometry(1280, 720);
    expect(floor.scale).toBe(2 / 3);
    expect(floor.origin).toStrictEqual({ x: 0, y: 0 });
    const tall = paperGeometry(1586, 1002);
    expect(tall.scale).toBe(1586 / 1920);
    expect(tall.origin.y).toBeGreaterThan(50);
  });

  test('收缩档与竖版的内容层不缩放', () => {
    for (const [width, height] of [
      [1200, 720],
      [390, 700],
      [864, 1536],
    ] as const) {
      expect(paperGeometry(width, height).scale, `${width} × ${height}`).toBe(1);
    }
  });

  test('compact：版心 min(容器宽, 1136) × 700，右栏宽跟着在 364…600 之间变，罗盘件缩到 0.8', () => {
    const wide = paperGeometry(1200, 720);
    expect(wide.sheet).toStrictEqual({ width: 1136, height: 700 });
    expect(wide.fields).toStrictEqual({ x: 512, y: 16, width: 600, mode: 'compact' });
    expect(wide.origin).toStrictEqual({ x: 32, y: 10 });
    const tight = paperGeometry(900, 700);
    expect(tight.sheet).toStrictEqual({ width: 900, height: 700 });
    expect(tight.fields.width).toBe(364);
    expect(tight.dial?.scale).toBe(COMPACT_SCALE);
    const [compass, right, center] = tight.arcs;
    expect(compass?.r).toBe((SHEET_ARCS[0]?.r ?? 0) * COMPACT_SCALE);
    expect([compass?.cx, compass?.cy]).toStrictEqual([250, 312]);
    expect(right && right.cx < tight.fields.x + tight.fields.width).toBe(true);
    expect([center?.cx, center?.cy]).toStrictEqual([450, 350]);
    const [, rightCross] = tight.crosses;
    expect(rightCross?.[0]).toBe(900 - 156);
  });

  test('narrow：单栏宽 min(600, 容器宽 − 32)，没有罗盘与弧；比版心矮时顶对齐，高时垂直居中', () => {
    const phone = paperGeometry(390, 600);
    expect(phone.tier).toBe('narrow');
    expect(phone.dial).toBe(null);
    expect(phone.arcs).toStrictEqual([]);
    expect(phone.fields).toStrictEqual({ x: 16, y: 208, width: 358, mode: 'narrow' });
    expect(phone.origin).toStrictEqual({ x: 0, y: 0 });
    const tall = paperGeometry(390, 900);
    expect(tall.origin.y).toBe(100);
    const short = paperGeometry(1920, 650);
    expect(short.sheet).toStrictEqual({ width: 632, height: 700 });
    expect(short.fields.width).toBe(600);
    expect(short.origin.x).toBe((1920 - 632) / 2);
  });

  test('竖版两档：640 宽版心上环下表，山脊图沉底；紧凑竖版罗盘缩到 0.8、右栏去声场', () => {
    const portrait = paperGeometry(864, 1536);
    expect(portrait.sheet).toStrictEqual({ width: 640, height: 1440 });
    expect(portrait.dial).toStrictEqual({ x: 320, y: 286, scale: 1, transportOffset: 320 });
    expect(portrait.fields.mode).toBe('full');
    expect(portrait.sunkTerrain).toBe(true);
    const compact = paperGeometry(720, 1280);
    expect(compact.sheet).toStrictEqual({ width: 640, height: 1240 });
    expect(compact.dial?.scale).toBe(COMPACT_SCALE);
    expect(compact.fields.mode).toBe('compact');
    expect(compact.sunkTerrain).toBe(true);
  });

  test('竖窄档：上段照紧凑竖版，下段是 narrow 的六块；版心 640 × 1047，矮容器顶对齐、高容器居中', () => {
    expect(PORTRAIT_NARROW_HEIGHT).toBe(1047);
    const compact = paperGeometry(720, 1280);
    const short = paperGeometry(700, 1000);
    expect(short.tier).toBe('portrait-narrow');
    expect(short.sheet).toStrictEqual({ width: 640, height: 1047 });
    expect(short.dial).toStrictEqual(compact.dial);
    expect(short.fields).toStrictEqual({ x: 20, y: 555, width: 600, mode: 'narrow' });
    expect(short.origin).toStrictEqual({ x: 30, y: 0 });
    expect(short.sunkTerrain).toBe(true);
    expect(short.arcs.length).toBe(3);
    expect(short.arcs[0]).toStrictEqual(compact.arcs[0]);
    const tall = paperGeometry(800, 1200);
    expect(tall.origin).toStrictEqual({ x: 80, y: (1200 - 1047) / 2 });
  });
});
