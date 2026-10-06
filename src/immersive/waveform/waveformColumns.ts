/**
 * 图纸整轨波形的数值部分，纯函数，不碰 canvas。
 *
 * 宿主给 1024 个 rms 点，按 canvas 的像素宽排成一列一列的竖条：每列 2 px 条加 1 px 空，600 宽正好 200 列。
 * 一列覆盖多个点时取其中最大的那个，短促的响段才不会被相邻的静段均掉。
 */
export const COLUMN_WIDTH = 2;
export const COLUMN_GAP = 1;
export const COLUMN_PITCH = COLUMN_WIDTH + COLUMN_GAP;

/** 宽 `width`（CSS 像素）放得下几列：最后一列后面不需要空。 */
export function columnCount(width: number): number {
  return width > 0 ? Math.max(0, Math.floor((width + COLUMN_GAP) / COLUMN_PITCH)) : 0;
}

/** 播放头在 `playedX`（CSS 像素）时有几列算已播：列的中线不在播放头右边就算。 */
export function playedColumnCount(playedX: number): number {
  return Math.max(0, Math.floor((playedX - COLUMN_WIDTH / 2) / COLUMN_PITCH) + 1);
}

/** 把点重采样成 `count` 列，每列取所覆盖点的最大值，夹到 0…1；点比列少时一列至少取一个点。 */
export function columnLevels(points: ArrayLike<number>, count: number): Float32Array {
  const levels = new Float32Array(Math.max(0, count));
  const total = points.length;
  if (total === 0) return levels;
  for (let column = 0; column < levels.length; column += 1) {
    const start = Math.min(Math.floor((column * total) / levels.length), total - 1);
    const end = Math.max(start + 1, Math.floor(((column + 1) * total) / levels.length));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = points[index] ?? 0;
      if (value > peak) peak = value;
    }
    levels[column] = Math.min(peak, 1);
  }
  return levels;
}

/** 波形上横坐标 `x` 对应的秒数；出了两端按两端算。 */
export function secondsAt(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return Math.min(Math.max(x / width, 0), 1) * duration;
}
