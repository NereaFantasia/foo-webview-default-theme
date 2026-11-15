import { describe, expect, it } from 'vitest';
import { bleedHandles } from '../../../../src/immersive/presets/bleed/bleedHandles.ts';
import { bleedLayoutOf } from '../../../../src/immersive/presets/bleed/bleedLayout.ts';
import { BLEED_SCHEMA } from '../../../../src/immersive/presets/bleed/bleedOptions.ts';
import {
  settleValue,
  type EditHandle,
  type HandleInput,
} from '../../../../src/immersive/scene/editHandles.ts';

// 满幅封面在设置编辑里能拖的线：线落在版式算出的位置上，把线拖到某处换出的值，正是让那条边落到那里的值

const BOX = { width: 1280, height: 720 };
const CAPSULE = { x: 100, y: 624, width: 440, height: 60 };

function input(values: Record<string, unknown> = {}, centered = false): HandleInput {
  return { box: BOX, centered, values, targets: { capsule: { rect: CAPSULE, radius: 16 } } };
}

const handleOf = (key: string, plan = bleedHandles(input())) =>
  plan.handles.find((handle) => handle.key === key);

/** 拖柄的第几条线，要是直线 */
function lineOf(handle: EditHandle | undefined, index = 0) {
  const guide = handle?.guides[index];
  if (guide?.kind !== 'line') throw new Error('不是直线');
  return guide;
}

/** 拖柄的第几条线，要是椭圆 */
function ellipseOf(handle: EditHandle | undefined, index = 0) {
  const guide = handle?.guides[index];
  if (guide?.kind !== 'ellipse') throw new Error('不是椭圆');
  return guide;
}

describe('布局组', () => {
  it('封面宽度：一条竖线在封面右缘、整窗高；拖到 x 处换出的宽度让右缘正好落在 x', () => {
    const handle = handleOf('coverWidth')!;
    expect(lineOf(handle)).toMatchObject({ from: { x: 742, y: 0 }, to: { x: 742, y: 720 } });
    const value = handle.value({ x: 832, y: 300 });
    expect(
      Math.round(bleedLayoutOf(BOX, false, { ...defaults(), coverWidth: value }).coverWidth),
    ).toBe(832);
  });

  it('封面宽度在居中时两边对称：右缘挪多少，宽度变两倍', () => {
    const handle = handleOf('coverWidth', bleedHandles(input({}, true)))!;
    const value = handle.value({ x: 640 + 400, y: 0 });
    expect(value).toBeCloseTo((800 / 1280) * 100);
  });

  it('右栏起点只在不居中时有：竖线在右栏左缘，从列上沿到窗底；换出的是窗宽的百分数', () => {
    const handle = handleOf('sideStart')!;
    expect(lineOf(handle)).toMatchObject({ from: { x: 640, y: 80 }, to: { x: 640, y: 720 } });
    expect(handle.value({ x: 704, y: 400 })).toBeCloseTo(55);
    expect(handleOf('sideStart', bleedHandles(input({}, true)))).toBeUndefined();
  });

  it('底部边距：一条横跨整窗的横线，换出的是离窗底的距离', () => {
    const handle = handleOf('capsuleBottom')!;
    expect(lineOf(handle)).toMatchObject({
      from: { x: 0, y: 720 - 36 },
      to: { x: 1280, y: 720 - 36 },
    });
    expect(handle.value({ x: 0, y: 660 })).toBe(60);
  });

  it('取景：没有封面原始尺寸时不动；方图铺满竖长的框只能纵向挪，画面跟着指针走', () => {
    expect(bleedHandles(input()).gestures[0]?.drag({ x: 40, y: 40 })).toEqual({});
    const plan = bleedHandles({
      ...input(),
      targets: {
        cover: {
          rect: { x: 0, y: 0, width: 742, height: 720 },
          radius: 0,
          natural: { width: 1000, height: 1000 },
        },
      },
    });
    const gesture = plan.gestures[0]!;
    // 方图按宽铺满 742 宽的框，高 742，比框多出 22：往下拖 11 像素，取景纵向从 50 退到 0 的一半
    const next = gesture.drag({ x: 30, y: 11 });
    expect(Object.keys(next)).toEqual(['focusY']);
    expect(next['focusY']).toBeCloseTo(0);
  });

  it('滚轮一格是封面缩放的一个步长，朝上放大', () => {
    const gesture = bleedHandles(input({ coverZoom: 110 })).gestures[0]!;
    expect(gesture.wheel(1)).toEqual({ coverZoom: 115 });
    expect(gesture.wheel(-1)).toEqual({ coverZoom: 105 });
  });
});

describe('遮罩组', () => {
  it('羽化起点与终点：两道椭圆弧以封面左缘中点为圆心，横半径按封面宽的百分数；宽度是终点减起点', () => {
    const plan = bleedHandles(input());
    const start = ellipseOf(handleOf('featherStart', plan));
    const end = ellipseOf(handleOf('featherWidth', plan));
    expect(start.center).toEqual({ x: 0, y: 360 });
    expect(start.rx).toBeCloseTo((742 * 38) / 100);
    expect(end.rx).toBeCloseTo((742 * 80) / 100);
    expect(handleOf('featherWidth', plan)!.value({ x: (742 * 90) / 100, y: 0 })).toBeCloseTo(52);
  });

  it('羽化关着时没有羽化的线，压暗带的还在', () => {
    const plan = bleedHandles(input({ feather: false }));
    expect(handleOf('featherStart', plan)).toBeUndefined();
    expect(handleOf('scrimHeight', plan)).toBeDefined();
  });

  it('压暗高度：横线在压暗带上沿、横跨看得见的封面，换出的是占窗高的百分数', () => {
    const handle = handleOf('scrimHeight')!;
    const guide = lineOf(handle);
    expect(guide.from.y).toBeCloseTo(720 * (1 - 0.26));
    expect(guide.from.x).toBe(0);
    expect(guide.to.x).toBe(742);
    expect(handle.value({ x: 0, y: 720 - 144 })).toBeCloseTo(20);
  });
});

describe('胶囊组', () => {
  it('胶囊宽度：两端各一条竖线，拖哪一条都按到中线距离的两倍算，受右栏左缘减两边留白约束', () => {
    const handle = handleOf('capsuleWidth')!;
    expect(lineOf(handle, 0).from.x).toBe(100);
    expect(lineOf(handle, 1).from.x).toBe(540);
    expect(handle.value({ x: 320 + 240, y: 0 })).toBe(480);
    expect(handle.value({ x: 320 - 240, y: 0 })).toBe(480);
    expect(handle.value({ x: 320 + 400, y: 0 })).toBe(640 - 48);
  });

  it('两条竖线压在胶囊的直边上，上下让开圆角；圆角大到直边太短时至少留 24 长', () => {
    expect(lineOf(handleOf('capsuleWidth'))).toMatchObject({
      from: { y: 624 + 16 },
      to: { y: 624 + 60 - 16 },
    });
    const pill = bleedHandles({
      ...input(),
      targets: { capsule: { rect: CAPSULE, radius: 30 } },
    });
    const guide = lineOf(handleOf('capsuleWidth', pill));
    expect(guide.to.y - guide.from.y).toBe(24);
  });

  it('没有胶囊的矩形时不画胶囊的线', () => {
    const plan = bleedHandles({ ...input(), targets: {} });
    expect(handleOf('capsuleWidth', plan)).toBeUndefined();
  });
});

describe('取整与夹值', () => {
  it('按步长取整、夹到范围；不是范围项时原样返回', () => {
    expect(settleValue(BLEED_SCHEMA.capsuleWidth, 487)).toBe(490);
    expect(settleValue(BLEED_SCHEMA.capsuleWidth, 900)).toBe(520);
    expect(settleValue(BLEED_SCHEMA.coverZoom, 90)).toBe(100);
    expect(settleValue(BLEED_SCHEMA.feather, 3)).toBe(3);
    expect(settleValue(undefined, 3.3)).toBe(3.3);
  });
});

function defaults() {
  return { coverWidth: 58, sideStart: 50, coverShift: 0, capsuleWidth: 440, capsuleBottom: 36 };
}
