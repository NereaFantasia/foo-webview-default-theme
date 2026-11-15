/** 横排行的条目尺寸：宽度的下限与上限（像素），以及宽度在两者之间时一屏露出的整张数 */
export interface RailShape {
  readonly min: number;
  readonly max: number;
  readonly per: number;
}

/** 条目多于一屏时，行的右边留给下一张的宽度（像素） */
export const RAIL_PEEK = 44;
/** 相邻两张之间的间距（像素） */
export const RAIL_GAP = 16;

export interface RailLayout {
  /** 每张的宽度，像素 */
  readonly width: number;
  /** 一屏露出的整张数 */
  readonly count: number;
  /** 条目多于一屏，要翻页 */
  readonly paged: boolean;
}

/**
 * 横排行的条目宽度与一屏的整张数
 * 行宽变大时宽度只增不减，只在上下限处封顶；一屏放得下时不留露边，宽度撑满到上限
 */
export function railLayout(
  rowWidth: number,
  itemCount: number,
  shape: RailShape,
  gap: number,
): RailLayout {
  const { min, max, per } = shape;
  const room = rowWidth - RAIL_PEEK;
  const width = Math.min(rowWidth, max, Math.max(min, room / per - gap));
  // 浮点误差会让恰好放下的那一张被舍掉
  const count = Math.max(1, Math.floor(room / (width + gap) + 1e-6));
  if (itemCount > count) return { width, count, paged: true };
  const items = Math.max(1, itemCount);
  const filled = Math.min(max, (rowWidth + gap) / items - gap);
  return { width: Math.min(rowWidth, Math.max(width, filled)), count: items, paged: false };
}
