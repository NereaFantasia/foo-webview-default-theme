/**
 * 计算平铺网格的虚拟滚动可见行区间 `[first, last)`
 *
 * 根据网格相对于滚动视口的位移与视口高度计算可见行范围；
 * 上下按 overscan 扩充缓冲区以平滑快速滚动，结果严格截断在 `[0, rowCount]` 区间内
 */
export function visibleRows(
  top: number,
  viewport: number,
  rowHeight: number,
  rowCount: number,
  overscan: number,
): { readonly first: number; readonly last: number } {
  if (!(rowHeight > 0) || rowCount <= 0) return { first: 0, last: Math.max(0, rowCount) };
  const clamp = (value: number) => Math.min(rowCount, Math.max(0, value));
  const first = clamp(Math.floor(-top / rowHeight) - overscan);
  const last = clamp(Math.ceil((viewport - top) / rowHeight) + overscan);
  return { first, last: Math.max(first, last) };
}
