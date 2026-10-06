import {
  columnDef,
  columnTrack,
  NARROW_COLUMNS,
  NARROW_WIDTH,
  widthOf,
  type ColumnId,
  type ColumnWidths,
} from './columns.ts';

// 列的状态与它推出的版式：这一刻画哪些列、栅格怎么写、分隔条拖哪两列。

export interface ColumnsState {
  readonly widths: ColumnWidths;
  readonly hidden: ReadonlySet<ColumnId>;
  readonly order: readonly ColumnId[];
  /** 表格容器的内容宽，CSS 像素；量到之前是 0。 */
  readonly containerWidth: number;
}

export interface ColumnsLayout {
  readonly narrow: boolean;
  /** 列头画的列，按显示顺序；封面出现时打头。 */
  readonly header: readonly ColumnId[];
  /** 曲目行画的列：列头去掉封面。封面跨整组，不在任何一行里。 */
  readonly cells: readonly ColumnId[];
  readonly headerTemplate: string;
  readonly rowTemplate: string;
  /** 封面列此刻的宽度，不出现时为 0；行的左缘让开这么多。 */
  readonly coverWidth: number;
}

/** 一张表自己的收列档：容器不宽于 `width` 时先收起这几列，窄档再照 `NARROW_COLUMNS` 收。 */
export interface ColumnsCompact {
  /** CSS 像素，应大于 `NARROW_WIDTH`。 */
  readonly width: number;
  readonly columns: readonly ColumnId[];
}

/**
 * 按状态算这一刻画哪些列、栅格怎么写。窄档只留 `NARROW_COLUMNS`，给了 `compact` 时容器不够宽先收起它那几列；
 * 封面列要等量到容器宽度才出现，宽度夹在容器宽的三分之一以内。
 */
export function columnsLayout(
  state: ColumnsState,
  offered: readonly ColumnId[],
  compact?: ColumnsCompact,
): ColumnsLayout {
  const measured = state.containerWidth > 0;
  const narrow = measured && state.containerWidth <= NARROW_WIDTH;
  const squeezed: readonly ColumnId[] =
    compact && measured && state.containerWidth <= compact.width ? compact.columns : [];
  const shown = (id: ColumnId) =>
    offered.includes(id) &&
    !state.hidden.has(id) &&
    (!narrow || NARROW_COLUMNS.has(id)) &&
    !squeezed.includes(id);
  const cells = state.order.filter((id) => id !== 'cover' && shown(id));
  const cover = shown('cover') && measured;
  const coverWidth = cover ? Math.min(widthOf(state.widths, 'cover'), state.containerWidth / 3) : 0;
  const rowTemplate = cells.map((id) => columnTrack(id, state.widths)).join(' ');
  return {
    narrow,
    header: cover ? ['cover', ...cells] : cells,
    cells,
    headerTemplate: cover ? `${coverWidth}px ${rowTemplate}` : rowTemplate,
    rowTemplate,
    coverWidth,
  };
}

/**
 * 拖 `left` 右缘的分隔条时，另一侧跟着让宽度的列：它右边第一个不定宽的列。定宽的列（状态、等级）
 * 夹在中间时原宽不动、整体跟着挪。封面列不找另一侧，只改自己；定宽列与找不到另一侧的列没有分隔条。
 */
export function resizePartner(layout: ColumnsLayout, left: ColumnId): ColumnId | 'self' | null {
  if (left === 'cover') return layout.header.includes('cover') ? 'self' : null;
  if (columnDef(left).fixed) return null;
  const at = layout.cells.indexOf(left);
  if (at < 0) return null;
  return layout.cells.slice(at + 1).find((id) => !columnDef(id).fixed) ?? null;
}
