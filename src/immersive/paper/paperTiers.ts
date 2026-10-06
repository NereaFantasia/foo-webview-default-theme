import { SHEET_ARCS, type DecorArc, type Rect } from '../decor/paperDecor.ts';
import { fitsStage, STAGE_ARCS, STAGE_LAYOUT, stageOrigin, stageScale } from './paperStage.ts';

/**
 * 仪表图纸按容器尺寸分六档，给出每档的内容层尺寸与里面各块的位置。坐标都是内容层坐标。
 *
 * 高大于宽且宽够 640 时先判竖版三档（上环下表）：portrait 件件原尺寸，portrait-compact 罗盘缩到 0.8、
 * 右栏去声场与文件信息，portrait-narrow 上段照 portrait-compact、下段换成 narrow 的六块。
 * 都不满足再按横版三档：full 是 1920 × 1080 的舞台（`paperStage.ts`），整幅等比缩放、居中；compact 左环右表，
 * 罗盘件缩到 0.8、右栏去声场与文件信息，右栏宽随容器在 364…600 之间变；其余都落 narrow 单栏：顶部一行
 * 小封面与传输键，下面只留 From / 标题 / By / 频谱 / 波形 / 歌词。
 * 收缩档与竖版按原 1280 × 800 版心的几何排、不缩放文字，罗盘件只有原尺寸与 0.8 两套；各块的高度由组件按
 * `mode` 定，这里只给位置与宽。
 */
export type PaperTier =
  'full' | 'compact' | 'narrow' | 'portrait' | 'portrait-compact' | 'portrait-narrow';
/** 右栏怎么收：full 全出，compact 去声场与文件信息 3 × 2，narrow 只留六块。 */
export type FieldsMode = 'full' | 'compact' | 'narrow';

export const COMPACT_MIN_WIDTH = 900;
export const COMPACT_MIN_HEIGHT = 700;
export const PORTRAIT_MIN_WIDTH = 640;
export const PORTRAIT_MIN_HEIGHT = 1440;
export const PORTRAIT_COMPACT_MIN_HEIGHT = 1240;
/**
 * 竖窄档的下限：上段到 555 再加六块里除歌词外的定高 385 是 940，1000 给歌词剩 60（表头加一行）；
 * 再矮留着环也只剩上半张在看，落回 narrow。1000…1047 之间版心比容器高，顶对齐、歌词底部被裁。
 */
export const PORTRAIT_NARROW_MIN_HEIGHT = 1000;
/** 紧凑竖版与竖窄档的右栏顶边；narrow 单栏的右栏顶边。 */
const PORTRAIT_COMPACT_FIELDS_Y = 555;
const NARROW_FIELDS_Y = 208;
/** 竖窄档版心高：上段照紧凑竖版到 555，下段给 narrow 那一栏同样的高（700 − 208），歌词室一致。 */
export const PORTRAIT_NARROW_HEIGHT =
  PORTRAIT_COMPACT_FIELDS_Y + COMPACT_MIN_HEIGHT - NARROW_FIELDS_Y;
/** compact 的右栏：左缘在版心 x 512，右边留 24，宽 364…600，版心随之在 900…1136 之间。 */
const COMPACT_FIELDS_X = 512;
const COMPACT_RIGHT_MARGIN = 24;
const FIELDS_WIDTH = 600;
/** narrow 单栏两侧各留的边距。 */
export const NARROW_MARGIN = 16;
/** 紧凑档罗盘件的缩放：封面 240、三环 157 / 189 / 221、传输键 45 / 64 / 45。 */
export const COMPACT_SCALE = 0.8;

export interface DialPlacement {
  /** 罗盘圆心。 */
  x: number;
  y: number;
  /** 罗盘件（环、封面、刻度位置、转动层、传输键）的缩放，文字字号不缩。 */
  scale: number;
  /** 传输键一行的圆心在罗盘圆心下方多远。 */
  transportOffset: number;
}

export interface PaperGeometry {
  tier: PaperTier;
  sheet: { width: number; height: number };
  /** 内容层左上角在容器里的位置；narrow 与竖窄档放不下时顶对齐，底部先被裁。 */
  origin: { x: number; y: number };
  /** 内容层的缩放：full 档是舞台的 s，其余各档是 1。 */
  scale: number;
  /** narrow 没有罗盘，为 null。 */
  dial: DialPlacement | null;
  fields: { x: number; y: number; width: number; mode: FieldsMode };
  crosses: readonly (readonly [number, number])[];
  pad: Rect;
  arcs: readonly DecorArc[];
  /** 竖版各档里山脊图不铺满，按 1280 × 800 一块沉到容器底部、两侧裁掉。 */
  sunkTerrain: boolean;
}

export function paperTier(width: number, height: number): PaperTier {
  if (height > width && width >= PORTRAIT_MIN_WIDTH) {
    if (height >= PORTRAIT_MIN_HEIGHT) return 'portrait';
    if (height >= PORTRAIT_COMPACT_MIN_HEIGHT) return 'portrait-compact';
    if (height >= PORTRAIT_NARROW_MIN_HEIGHT) return 'portrait-narrow';
  }
  if (fitsStage(width, height)) return 'full';
  if (width >= COMPACT_MIN_WIDTH && height >= COMPACT_MIN_HEIGHT) return 'compact';
  return 'narrow';
}

type Layout = Omit<PaperGeometry, 'tier' | 'origin' | 'scale' | 'arcs' | 'sunkTerrain'>;

const FULL_FIELDS = { x: 584, y: 44 };

/**
 * 三段仪表弧跟着各自的锚点走：一段绕罗盘圆心，一段挂在右栏右缘与顶边上，一段绕版心中心；
 * 半径与到锚点的距离按罗盘缩放。`SHEET_ARCS` 是 1280 × 800 版心上罗盘原尺寸、右栏左上在 `FULL_FIELDS`
 * 时的三段弧，这套排法代进来算出的就是它本身。
 */
function arcsFor(layout: Layout): DecorArc[] {
  const { dial, fields, sheet } = layout;
  const [compass, right, center] = SHEET_ARCS;
  if (!dial || !compass || !right || !center) return [];
  const s = dial.scale;
  const fullRight = FULL_FIELDS.x + FIELDS_WIDTH;
  return [
    { ...compass, cx: dial.x, cy: dial.y, r: compass.r * s },
    {
      ...right,
      cx: fields.x + fields.width - (fullRight - right.cx) * s,
      cy: fields.y + (right.cy - FULL_FIELDS.y) * s,
      r: right.r * s,
    },
    { ...center, cx: sheet.width / 2, cy: sheet.height / 2, r: center.r * s },
  ];
}

function layoutFor(tier: PaperTier, width: number): Layout {
  switch (tier) {
    case 'full':
      return STAGE_LAYOUT;
    case 'compact': {
      const sheetWidth = Math.min(
        Math.max(width, COMPACT_MIN_WIDTH),
        COMPACT_FIELDS_X + FIELDS_WIDTH + COMPACT_RIGHT_MARGIN,
      );
      const fieldsWidth = sheetWidth - COMPACT_FIELDS_X - COMPACT_RIGHT_MARGIN;
      return {
        sheet: { width: sheetWidth, height: COMPACT_MIN_HEIGHT },
        dial: { x: 250, y: 312, scale: COMPACT_SCALE, transportOffset: 265 },
        fields: { x: COMPACT_FIELDS_X, y: 16, width: fieldsWidth, mode: 'compact' },
        crosses: [
          [COMPACT_FIELDS_X - 25, 105],
          [sheetWidth - 156, 263],
          [COMPACT_FIELDS_X + 44, 630],
          [83, 560],
        ],
        pad: { x: COMPACT_FIELDS_X - 28, y: 150, w: fieldsWidth + 56, h: 544 },
      };
    }
    case 'narrow': {
      const sheetWidth = Math.min(FIELDS_WIDTH + NARROW_MARGIN * 2, width);
      const fieldsWidth = sheetWidth - NARROW_MARGIN * 2;
      return {
        sheet: { width: sheetWidth, height: COMPACT_MIN_HEIGHT },
        dial: null,
        fields: { x: NARROW_MARGIN, y: NARROW_FIELDS_Y, width: fieldsWidth, mode: 'narrow' },
        crosses: [
          [sheetWidth - 10, 200],
          [10, 356],
          [sheetWidth - 10, 594],
          [10, 690],
        ],
        pad: { x: 4, y: 342, w: sheetWidth - 8, h: 340 },
      };
    }
    case 'portrait':
      return {
        sheet: { width: PORTRAIT_MIN_WIDTH, height: PORTRAIT_MIN_HEIGHT },
        dial: { x: 320, y: 286, scale: 1, transportOffset: 320 },
        fields: { x: 20, y: 684, width: FIELDS_WIDTH, mode: 'full' },
        crosses: [
          [-16, 32],
          [656, 672],
          [-16, 1152],
          [656, 1408],
        ],
        pad: { x: -8, y: 828, w: 656, h: 560 },
      };
    case 'portrait-compact':
      return {
        sheet: { width: PORTRAIT_MIN_WIDTH, height: PORTRAIT_COMPACT_MIN_HEIGHT },
        dial: { x: 320, y: 236, scale: COMPACT_SCALE, transportOffset: 265 },
        fields: { x: 20, y: PORTRAIT_COMPACT_FIELDS_Y, width: FIELDS_WIDTH, mode: 'compact' },
        crosses: [
          [8, 31],
          [632, 559],
          [8, 1007],
          [632, 1215],
        ],
        pad: { x: -8, y: 689, w: 656, h: 544 },
      };
    case 'portrait-narrow':
      // 上段与紧凑竖版一字不差；下段是 narrow 的六块，下面两个十字与垫纸按矮下来的右栏重摆。
      return {
        sheet: { width: PORTRAIT_MIN_WIDTH, height: PORTRAIT_NARROW_HEIGHT },
        dial: { x: 320, y: 236, scale: COMPACT_SCALE, transportOffset: 265 },
        fields: { x: 20, y: PORTRAIT_COMPACT_FIELDS_Y, width: FIELDS_WIDTH, mode: 'narrow' },
        crosses: [
          [8, 31],
          [632, 559],
          [8, 880],
          [632, 1029],
        ],
        pad: { x: -8, y: 689, w: 656, h: 340 },
      };
  }
}

/** 容器 `width` × `height`（CSS 像素）下的图纸几何。 */
export function paperGeometry(width: number, height: number): PaperGeometry {
  const tier = paperTier(width, height);
  const layout = layoutFor(tier, width);
  if (tier === 'full') {
    const scale = stageScale(width, height);
    const origin = stageOrigin(width, height, scale);
    return { tier, ...layout, origin, scale, arcs: STAGE_ARCS, sunkTerrain: false };
  }
  return {
    tier,
    ...layout,
    origin: {
      x: (width - layout.sheet.width) / 2,
      y: Math.max(0, (height - layout.sheet.height) / 2),
    },
    scale: 1,
    arcs: arcsFor(layout),
    sunkTerrain: tier.startsWith('portrait'),
  };
}
