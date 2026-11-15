import { featherShapes } from '../../bleed-cover/feather.ts';
import type {
  EditGesture,
  EditHandle,
  EditHandles,
  HandleInput,
  Point,
  Rect,
} from '../../scene/editHandles.ts';
import { COLUMN_TOP, bleedLayoutOf } from './bleedLayout.ts';
import { BLEED_SCHEMA } from './bleedOptions.ts';

/**
 * 满幅封面在设置编辑里的拖柄与手势：线的位置全由版式（`bleedLayoutOf`）与羽化几何（`featherShapes`）算出，
 * 与预设自己排版用的是同一套公式，改版式时线跟着对
 *
 * 布局组：封面右缘（封面宽度）、右栏左缘（右栏起点，只在不居中时）、底部边距（横跨胶囊底与右栏列底的一条线），
 * 在封面上按住拖是取景、滚轮是封面缩放。遮罩组：羽化起点与终点两道椭圆弧（羽化开着时）、压暗带的上沿。
 * 胶囊组：胶囊左右两条竖边，宽度两端对称。封面左移、浓度、模糊强度、压暗强度、两个开关只在卡片里调
 */

const LAYOUT = 'immersive.group.layout';
const MASK = 'immersive.group.mask';
const CAPSULE = 'immersive.group.capsule';

type RangeKey = {
  [K in keyof typeof BLEED_SCHEMA]: (typeof BLEED_SCHEMA)[K]['kind'] extends 'range' ? K : never;
}[keyof typeof BLEED_SCHEMA];

/** 胶囊离所在半区边缘至少这么远，与版式里的 `CAPSULE_EDGE` 同值：宽度的上限是右栏左缘减两倍 */
const CAPSULE_EDGE = 24;

const line = (from: Point, to: Point) => ({ kind: 'line', from, to }) as const;

export function bleedHandles({ box, centered, values, targets }: HandleInput): EditHandles {
  const read = (key: RangeKey): number => {
    const value = values[key];
    return typeof value === 'number' ? value : BLEED_SCHEMA[key].default;
  };
  const { width, height } = box;
  const layout = bleedLayoutOf(box, centered, {
    coverWidth: read('coverWidth'),
    sideStart: read('sideStart'),
    coverShift: read('coverShift'),
    capsuleWidth: read('capsuleWidth'),
    capsuleBottom: read('capsuleBottom'),
  });
  const coverLeft = layout.coverLeft;
  const coverRight = coverLeft + layout.coverWidth;
  const visible: Rect = {
    x: Math.max(0, coverLeft),
    y: 0,
    width: Math.max(0, Math.min(width, coverRight) - Math.max(0, coverLeft)),
    height,
  };
  const handles: EditHandle[] = [
    {
      group: LAYOUT,
      key: 'coverWidth',
      axis: 'x',
      guides: [line({ x: coverRight, y: 0 }, { x: coverRight, y: height })],
      // 居中时封面左右对称地变宽，右缘挪多少，宽度变两倍
      value: (point) =>
        centered ? ((2 * point.x - width) / width) * 100 : ((point.x - coverLeft) / width) * 100,
    },
  ];
  if (!centered) {
    handles.push({
      group: LAYOUT,
      key: 'sideStart',
      axis: 'x',
      guides: [line({ x: layout.sideLeft, y: COLUMN_TOP }, { x: layout.sideLeft, y: height })],
      value: (point) => (point.x / width) * 100,
    });
  }
  const bottom = height - read('capsuleBottom');
  handles.push({
    group: LAYOUT,
    key: 'capsuleBottom',
    axis: 'y',
    guides: [line({ x: 0, y: bottom }, { x: width, y: bottom })],
    value: (point) => height - point.y,
  });

  if (values['feather'] !== false) {
    const start = read('featherStart');
    const shape = featherShapes(start, read('featherWidth')).sharp;
    const ring = (percent: number) =>
      ({
        kind: 'ellipse',
        center: { x: coverLeft, y: height / 2 },
        rx: (layout.coverWidth * percent) / 100,
        ry: (height * percent * (shape.ry / shape.rx)) / 100,
        clip: visible,
      }) as const;
    const startPercent = shape.rx * shape.inner;
    handles.push(
      {
        group: MASK,
        key: 'featherStart',
        axis: 'x',
        guides: [ring(startPercent)],
        value: (point) => ((point.x - coverLeft) / layout.coverWidth) * 100,
      },
      {
        group: MASK,
        key: 'featherWidth',
        axis: 'x',
        guides: [ring(shape.rx)],
        value: (point) => ((point.x - coverLeft) / layout.coverWidth) * 100 - start,
      },
    );
  }
  const scrimTop = height * (1 - read('scrimHeight') / 100);
  handles.push({
    group: MASK,
    key: 'scrimHeight',
    axis: 'y',
    guides: [line({ x: visible.x, y: scrimTop }, { x: visible.x + visible.width, y: scrimTop })],
    value: (point) => ((height - point.y) / height) * 100,
  });

  const capsuleTarget = targets['capsule'];
  if (capsuleTarget) {
    const capsule = capsuleTarget.rect;
    const center = capsule.x + capsule.width / 2;
    const cap = layout.sideLeft - 2 * CAPSULE_EDGE;
    // 两条竖边压在胶囊左右两端的直边上，上下让开圆角，不从圆角外面伸出去；至少留 24 长，好抓
    const inset = Math.max(0, Math.min(capsuleTarget.radius, capsule.height / 2 - 12));
    const side = (x: number) =>
      line({ x, y: capsule.y + inset }, { x, y: capsule.y + capsule.height - inset });
    handles.push({
      group: CAPSULE,
      key: 'capsuleWidth',
      axis: 'x',
      guides: [side(capsule.x), side(capsule.x + capsule.width)],
      value: (point) => Math.min(2 * Math.abs(point.x - center), cap),
    });
  }

  const gestures: EditGesture[] = [];
  const natural = targets['cover']?.natural;
  const zoom = read('coverZoom');
  const focusX = read('focusX');
  const focusY = read('focusY');
  gestures.push({
    group: LAYOUT,
    target: 'cover',
    // 画面跟着指针走：图比框多出的那一截就是可裁的余量，指针挪过整截余量对应取景从 0 到 100；没有余量的轴不动
    drag(delta) {
      if (!natural || natural.width <= 0 || natural.height <= 0) return {};
      const scale =
        Math.max(layout.coverWidth / natural.width, height / natural.height) * (zoom / 100);
      const spareX = natural.width * scale - layout.coverWidth;
      const spareY = natural.height * scale - height;
      const next: Record<string, number> = {};
      if (spareX > 0.5) next['focusX'] = focusX - (delta.x / spareX) * 100;
      if (spareY > 0.5) next['focusY'] = focusY - (delta.y / spareY) * 100;
      return next;
    },
    wheel: (direction) => ({ coverZoom: zoom + direction * BLEED_SCHEMA.coverZoom.step }),
  });
  return { handles, gestures };
}
