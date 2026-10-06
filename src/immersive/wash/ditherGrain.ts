/**
 * 封面底色的抖动颗粒。大面积的柔和渐变经 8 bit 量化、再按 0.35–0.45 的透明度压到纸面上，相邻色阶之间
 * 隔得很宽，看得出一条条灰阶断层。在模糊层之上铺一层细颗粒，把断层的边界打散；颗粒必须叠在模糊之后，
 * 叠在之前会被一起糊掉。
 *
 * 每个像素是随机灰度、统一的低透明度：单个像素的起伏大于一个色阶，足够打散断层，整体只是一层很淡的纸纹。
 * 种子固定，同一尺寸每次生成同一张。
 */

/** 颗粒贴图的边长（像素），平铺使用。 */
export const GRAIN_SIZE = 256;
/** 颗粒的透明度，0–255。 */
export const GRAIN_ALPHA = 10;

export function grainPixels(
  size = GRAIN_SIZE,
  alpha = GRAIN_ALPHA,
  seed = 1,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(size * size * 4);
  let state = seed >>> 0 || 1;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    // xorshift32：只要均匀、可复现，不需要更好的随机性。
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    const gray = state & 0xff;
    pixels[offset] = gray;
    pixels[offset + 1] = gray;
    pixels[offset + 2] = gray;
    pixels[offset + 3] = alpha;
  }
  return pixels;
}
