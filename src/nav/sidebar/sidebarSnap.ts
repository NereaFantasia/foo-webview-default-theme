/**
 * 侧边栏拖拽折叠的吸附规则，只算形态、不碰 DOM。宽度都是 CSS 像素。
 *
 * 展开态的宽度夹在 200–360，图标态宽 48（Windows 11 NavigationView 的紧凑宽度）。拖动中实时吸附：
 * 展开态往左拖，指针对应的宽度过了 200 之后栏停住，过了收起线 116 立刻吸成图标态；图标态往右拖，过了
 * 展开线 132 立刻展开到 200，之后跟手。两条线取 48 与 200 的中点 124、各让 8 做滞回，指针在线附近抖动
 * 不会来回切。指针对应的宽度是指针离侧边栏左缘的距离减去握柄半宽，由握柄那一侧换算好再交进来。
 *
 * 图标态下展开宽度照样留着，展开时回到它。拖动途中吸成图标态时留的是拖动之前的展开宽度，不是途中
 * 停住的 200：用户要的是收起，不是把宽度改成 200。
 */
export const RAIL_WIDTH = 48;
export const COLLAPSE_LINE = 116;
export const EXPAND_LINE = 132;
/** 握柄上 ← / → 一步挪多少。 */
export const KEY_STEP = 16;

export interface SidebarShape {
  /** 图标态。 */
  readonly rail: boolean;
  /** 展开宽度。 */
  readonly width: number;
}

/** 展开宽度的上下限。 */
export interface SnapBounds {
  readonly min: number;
  readonly max: number;
}

function clamp(value: number, { min, max }: SnapBounds): number {
  return Math.round(Math.min(Math.max(min, max), Math.max(min, value)));
}

/**
 * 拖动中指针对应 `pointer` 宽时的形态。`shape` 是此刻的形态，`restWidth` 是拖动开始时的展开宽度，
 * 途中吸成图标态时留它。
 */
export function snapDrag(
  pointer: number,
  shape: SidebarShape,
  bounds: SnapBounds,
  restWidth: number,
): SidebarShape {
  if (shape.rail) {
    return pointer > EXPAND_LINE ? { rail: false, width: clamp(pointer, bounds) } : shape;
  }
  return pointer < COLLAPSE_LINE
    ? { rail: true, width: restWidth }
    : { rail: false, width: clamp(pointer, bounds) };
}

/**
 * 握柄上的按键：← / → 每步 16，展开态停在下限时再按 ← 进图标态，图标态按 → 回到下限；Home 到图标态，
 * End 到上限，Enter 切换。不认的键答 null，交还给调用方。
 */
export function snapKey(key: string, shape: SidebarShape, bounds: SnapBounds): SidebarShape | null {
  switch (key) {
    case 'ArrowLeft':
      if (shape.rail) return shape;
      return shape.width <= bounds.min
        ? { rail: true, width: shape.width }
        : { rail: false, width: clamp(shape.width - KEY_STEP, bounds) };
    case 'ArrowRight':
      return shape.rail
        ? { rail: false, width: bounds.min }
        : { rail: false, width: clamp(shape.width + KEY_STEP, bounds) };
    case 'Home':
      return { rail: true, width: shape.width };
    case 'End':
      return { rail: false, width: clamp(bounds.max, bounds) };
    case 'Enter':
      return toggleShape(shape);
    default:
      return null;
  }
}

/** 双击握柄与握柄上的 Enter：在图标态与上次的展开宽度之间切换。 */
export function toggleShape(shape: SidebarShape): SidebarShape {
  return { rail: !shape.rail, width: shape.width };
}
