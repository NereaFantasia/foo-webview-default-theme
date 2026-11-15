/** 窗高到字号档的映射；曲目信息、歌词字号与键的尺寸按它分档，各预设与 Coverflow 舞台共用同一份阈值 */
export type HeightTier = 'large' | 'medium' | 'small';

/** 窗口小到版式要压缩的界限：窗高低于它时取 `small` */
export const COMPACT_HEIGHT = 466;

/** 窗高不到这么高时取 `medium`（800 高取 `large`，600 高取 `medium`，取两者中点） */
export const LARGE_HEIGHT = 700;

export function heightTierOf(height: number): HeightTier {
  if (height >= LARGE_HEIGHT) return 'large';
  return height >= COMPACT_HEIGHT ? 'medium' : 'small';
}
