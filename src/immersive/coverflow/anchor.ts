/**
 * 条目表重排（切歌或队列增删）后重映射当前浏览锚点，保持视觉中心位置稳定
 *
 * 依据条目全局键而非数组下标进行相对位置重锚：选取重排前距当前视心最近的卡片为锚点，
 * 在新表中按键检索对应位置并保持小数偏移；锚点被移除时向两侧检索最近有效条目以维持相对间距；
 * 无任何匹配项时回退至 fallback，输出结果限制在新表索引范围内
 */
export function reanchor(
  previous: readonly string[],
  pos: number,
  next: readonly string[],
  fallback: number,
): number {
  if (previous.length === 0 || next.length === 0) return fallback;
  const indexOf = new Map(next.map((key, index) => [key, index]));
  const nearest = Math.min(previous.length - 1, Math.max(0, Math.round(pos)));
  for (let delta = 0; delta < previous.length; delta++) {
    const candidates = delta === 0 ? [nearest] : [nearest - delta, nearest + delta];
    for (const at of candidates) {
      const key = previous[at];
      const found = key === undefined ? undefined : indexOf.get(key);
      if (found !== undefined) {
        return Math.min(next.length - 1, Math.max(0, found + (pos - at)));
      }
    }
  }
  return fallback;
}
