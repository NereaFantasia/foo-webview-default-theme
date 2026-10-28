import { columnDef, columnTrack, widthOf, type ColumnId, type ColumnWidths } from './columns.ts';

// 列的状态与版式：用户勾选的列保留像素宽度，超出容器的部分横向滚动

export interface ColumnsState {
  readonly widths: ColumnWidths;
  readonly hidden: ReadonlySet<ColumnId>;
  readonly order: readonly ColumnId[];
  /** 表格容器的内容宽，CSS 像素；量到之前是 0 */
  readonly containerWidth: number;
  readonly legacyWeights?: Readonly<Partial<Record<ColumnId, number>>>;
}

export interface ColumnsLayout {
  /** 列头画的列，按显示顺序；封面出现时打头 */
  readonly header: readonly ColumnId[];
  /** 曲目行画的列：列头去掉封面。封面跨整组，不在任何一行里 */
  readonly cells: readonly ColumnId[];
  readonly headerTemplate: string;
  readonly rowTemplate: string;
  /** 封面列此刻的宽度，不出现时为 0；行的左缘让开这么多 */
  readonly coverWidth: number;
  /** 包含封面的整张表宽度；缩略图宽度由行高对应的 CSS 变量决定 */
  readonly contentWidth: string;
}

/**
 * 按用户的列显隐与像素宽度生成栅格，窗口变窄不隐藏列
 * 封面列要等量到容器宽度才出现，宽度夹在容器宽的三分之一以内
 */
export function columnsLayout(state: ColumnsState, offered: readonly ColumnId[]): ColumnsLayout {
  const measured = state.containerWidth > 0;
  const shown = (id: ColumnId) => offered.includes(id) && !state.hidden.has(id);
  const cells = state.order.filter((id) => id !== 'cover' && shown(id));
  const cover = shown('cover') && measured;
  const coverWidth = cover ? Math.min(widthOf(state.widths, 'cover'), state.containerWidth / 3) : 0;
  const rowTemplate = cells.map((id) => columnTrack(id, state.widths)).join(' ');
  return {
    header: cover ? ['cover', ...cells] : cells,
    cells,
    headerTemplate: cover ? `${coverWidth}px ${rowTemplate}` : rowTemplate,
    rowTemplate,
    coverWidth,
    contentWidth: `calc(${[...(cover ? [`${coverWidth}px`] : []), ...cells.map((id) => columnTrack(id, state.widths))].join(' + ') || '0px'})`,
  };
}

/**
 * 可调整的列都有自己的右缘手柄，包括最后一列；状态、评分和缩略图保持固定宽度
 */
export function canResizeColumn(layout: ColumnsLayout, id: ColumnId): boolean {
  return layout.header.includes(id) && !columnDef(id).fixed;
}
