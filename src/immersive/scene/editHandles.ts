import type { MessageKey } from '../../i18n/en.ts';
import type { OptionSpec } from './presetOptions.ts';

/**
 * 设置编辑里在画面上直接拖的线：预设按自己的版式声明，宿主（`page/`）画出来、跟踪指针、取整后写存档
 *
 * 坐标都是场景坐标（场景外框左上角为原点，CSS 像素）。一个拖柄对应一项可调项，属于它所在的那一组：
 * 只有编辑停在那一组时才画。拖柄没有握点，整条线就是拖的地方
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 能拖的线：直线，或圆心在某点的椭圆（只画在 `clip` 里的那一段） */
export type HandleGuide =
  | { readonly kind: 'line'; readonly from: Point; readonly to: Point }
  | {
      readonly kind: 'ellipse';
      readonly center: Point;
      readonly rx: number;
      readonly ry: number;
      readonly clip: Rect;
    };

export interface EditHandle {
  /** 所在的组（`PanelGroup.title`），也是编辑里分类的标识 */
  readonly group: MessageKey;
  /** 对应的可调项 */
  readonly key: string;
  /** 拖动方向，决定光标 */
  readonly axis: 'x' | 'y';
  /** 能拖的线，线上任何一处都能按住拖；两端对称的项有两条，拖哪一条都一样 */
  readonly guides: readonly HandleGuide[];
  /** 指针此刻的位置换成这一项的值：还没取整、没夹到范围 */
  value(point: Point): number;
}

/** 在某个元素上按住拖、滚轮调的手势：拖动给出几项的新值，滚轮一格给出几项的新值 */
export interface EditGesture {
  readonly group: MessageKey;
  /** 手势落在哪个元素上，与元素根上的 `data-edit-target` 对应 */
  readonly target: string;
  /** 从按下时的值起，指针挪了 `delta` 之后的值 */
  drag(delta: Point): Readonly<Record<string, number>>;
  /** 滚轮朝上为 1、朝下为 -1 */
  wheel(direction: 1 | -1): Readonly<Record<string, number>>;
}

export interface HandleInput {
  /** 场景外框的尺寸 */
  readonly box: { readonly width: number; readonly height: number };
  /** 版式此刻是不是居中（侧栏收起） */
  readonly centered: boolean;
  /** 各项此刻的值，已合并缺省 */
  readonly values: Readonly<Record<string, unknown>>;
  /** 画面上带编辑目标的元素此刻的矩形，以及元素报出的附加尺寸（如封面图的原始像素） */
  readonly targets: Readonly<Record<string, EditTarget>>;
}

/** 画面上一个带编辑目标的元素此刻的几何 */
export interface EditTarget {
  readonly rect: Rect;
  /** 元素自己的圆角（CSS 像素），描框跟着它 */
  readonly radius: number;
  /** 元素报出的原始像素，如封面图 */
  readonly natural?: Size;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface EditHandles {
  readonly handles: readonly EditHandle[];
  readonly gestures: readonly EditGesture[];
}

/** 把拖出来的值按声明夹到范围、按步长取整；不是范围项时原样返回 */
export function settleValue(spec: OptionSpec | undefined, value: number): number {
  if (!spec || spec.kind !== 'range' || !Number.isFinite(value)) return value;
  const stepped = spec.min + Math.round((value - spec.min) / spec.step) * spec.step;
  return Math.min(spec.max, Math.max(spec.min, stepped));
}
