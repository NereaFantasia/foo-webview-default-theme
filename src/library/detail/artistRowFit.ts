/**
 * 计算单行容器可完整容纳的艺术家胶囊数量
 * 宽度充裕时完整展示且不预留展开按钮空间；存在溢出时扣除展开按钮预留宽度计算最大容纳数，且至少保留首项
 */
export function fitCount(
  widths: readonly number[],
  gap: number,
  width: number,
  reserve: number,
): number {
  const all = widths.reduce((sum, item) => sum + item, 0) + gap * Math.max(0, widths.length - 1);
  if (all <= width) return widths.length;
  const room = width - reserve;
  let used = 0;
  let count = 0;
  for (const item of widths) {
    const next = used + (count > 0 ? gap : 0) + item;
    if (next > room) break;
    used = next;
    count += 1;
  }
  return Math.max(1, count);
}
