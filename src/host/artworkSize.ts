/** 封面请求尺寸按这个步长取整，档数少，宿主的缩放缓存才命中得了。 */
const SIZE_STEP = 128;
const MIN_SIZE = 256;
const MAX_SIZE = 1024;

/**
 * 向宿主要多大的封面（设备像素）：显示宽（CSS 像素）乘像素比，向上取到 128 的整数倍，
 * 夹在 256 到 1024 之间。像素比取不到或不是正数时按 1。
 */
export function artworkRequestSize(displayWidth: number, pixelRatio: number): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const width = Number.isFinite(displayWidth) && displayWidth > 0 ? displayWidth : 0;
  const stepped = Math.ceil((width * ratio) / SIZE_STEP) * SIZE_STEP;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, stepped));
}
