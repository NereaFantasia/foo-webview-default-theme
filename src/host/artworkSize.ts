/** 宿主封面尺寸阶梯步长（128 物理像素），阶梯化请求以提升宿主原生缩放缓存命中率 */
const SIZE_STEP = 128;
const MIN_SIZE = 256;
const MAX_SIZE = 1024;

/** 宿主接受的封面边长上限（宿主对更大的请求直接拒绝）；要按显示尺寸取大图的地方把它当 `max` 传进来 */
export const HOST_ARTWORK_MAX = 2048;

/**
 * 计算请求宿主封面缩略图的目标物理像素尺寸
 * 将 CSS 像素宽度乘以设备像素比（DPI）后向上对齐至 128 像素的整数倍，并限制在 [256, `max`] 区间内，
 * `max` 缺省 1024；封面占满大半个窗口的地方传 `HOST_ARTWORK_MAX`
 */
export function artworkRequestSize(
  displayWidth: number,
  pixelRatio: number,
  max: number = MAX_SIZE,
): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const width = Number.isFinite(displayWidth) && displayWidth > 0 ? displayWidth : 0;
  const stepped = Math.ceil((width * ratio) / SIZE_STEP) * SIZE_STEP;
  return Math.min(max, Math.max(MIN_SIZE, stepped));
}
