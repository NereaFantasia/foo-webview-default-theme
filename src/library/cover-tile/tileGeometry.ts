// 封面网格响应式排版计算内核
//
// 供封面墙与平铺网格共用；纯函数计算列数、间距补偿与居中对齐偏移量

/** 一行图块的几何尺寸，单位 CSS 像素 */
export interface TileMetrics {
  /** 块间距与行间距，用于计算列数 */
  readonly gap: number;
  /** 余量补充进块间距的上限倍数；为 1 时不拉伸间距，余量全部分配至两侧 */
  readonly stretch: number;
  /** 图块下方两行文字与其上方 2px 留白的总高度，即 `2 × (2 + lineHeight)`；无字档位为 0 */
  readonly textHeight: number;
  readonly lineHeight: number;
}

/**
 * 封面墙默认档（`grid`）的图块几何规范
 * 平铺专辑与歌单网格沿用该规格，边长缺省为 `STANDARD_TILE_SIZE`
 */
export const STANDARD_TILE_METRICS: TileMetrics = {
  gap: 12,
  stretch: 2,
  textHeight: 36,
  lineHeight: 16,
};

export const STANDARD_TILE_SIZE = 160;

/** 计算图块单行高度：边长加上行间距，含字档位计入两行文字高度 */
export function gridRowHeight(tileSize: number, metrics: Pick<TileMetrics, 'gap' | 'textHeight'>) {
  return tileSize + metrics.textHeight + metrics.gap;
}

/** 边长允许区间，两端均包含 */
export interface TileBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * 计算一行容纳的图块列数
 * 列数依据网格容器内宽计算，不依赖窗口宽度；未测出有效宽度时返回 1
 */
export function tilesPerRow(containerWidth: number, tileSize: number, gap: number): number {
  if (!(containerWidth > 0) || !(tileSize > 0)) return 1;
  const spacing = Math.max(0, gap);
  return Math.max(1, Math.floor((containerWidth + spacing) / (tileSize + spacing)));
}

/** 单行排版结果：列数、边长、实际块间距及居中偏移（节头文本对齐该偏移） */
export interface RowLayout {
  readonly perRow: number;
  readonly tileSize: number;
  readonly spacing: number;
  readonly offset: number;
}

/**
 * 计算单行图块几何排版
 *
 * 边长约束在给定区间内；优先拉伸块间距吸收剩余空间（上限为 gap × stretch），
 * 最终剩余余量均分于两侧形成居中边距；单列或无有效宽度时居中偏移量为 0
 */
export function layoutRow(
  containerWidth: number,
  tileSize: number,
  metrics: Pick<TileMetrics, 'gap' | 'stretch'>,
  bounds: TileBounds,
): RowLayout {
  const gap = Math.max(0, metrics.gap);
  const size = Math.min(bounds.max, Math.max(bounds.min, Math.round(tileSize)));
  if (!(containerWidth > 0)) return { perRow: 1, tileSize: size, spacing: gap, offset: 0 };
  const perRow = tilesPerRow(containerWidth, size, gap);
  const spacing =
    perRow > 1
      ? Math.min(
          gap * Math.max(1, metrics.stretch),
          (containerWidth - perRow * size) / (perRow - 1),
        )
      : gap;
  const rowWidth = perRow * size + (perRow - 1) * spacing;
  return { perRow, tileSize: size, spacing, offset: Math.max(0, (containerWidth - rowWidth) / 2) };
}

/** 末行不满时，该行各块要右移的列数（空出来的列的一半），让它在网格里居中；其余行为 0 */
export function tailShift(index: number, count: number, perRow: number): number {
  const tail = count % perRow;
  return tail > 0 && index >= count - tail ? (perRow - tail) / 2 : 0;
}

/**
 * 计算平铺网格指定索引项在内容坐标系中的二维位置（CSS 像素）
 * `shift` 是该块在所在行里额外右移的列数，可为小数，此时 `column` 也是小数
 */
export function flatPlace(
  index: number,
  row: Pick<RowLayout, 'perRow' | 'tileSize' | 'spacing' | 'offset'>,
  rowHeight: number,
  shift = 0,
): { readonly column: number; readonly x: number; readonly y: number } {
  const column = (index % row.perRow) + shift;
  return {
    column,
    x: Math.round(row.offset + column * (row.tileSize + row.spacing)),
    y: Math.floor(index / row.perRow) * rowHeight,
  };
}

/** 计算平铺网格累计总高度（扣除末行外边距，单位 CSS 像素） */
export function flatHeight(count: number, perRow: number, rowHeight: number, gap: number): number {
  const rows = Math.ceil(count / Math.max(1, perRow));
  return rows > 0 ? rows * rowHeight - gap : 0;
}
