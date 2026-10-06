/**
 * 判两张封面是不是同一张图：各缩成 `COVER_PROBE_SIZE` 见方的像素，逐格逐通道比，最大差不超过
 * `SAME_COVER_TOLERANCE` 就算同一张。
 *
 * 同专辑的曲子各自内嵌同一张图时，宿主给的地址按曲目文件拼、各不相同，只能比像素。同一份字节解出来
 * 逐位相同；同一张图重新编码过（各文件内嵌的尺寸、压缩质量不一）时，缩图用高质量滤波，编码噪声大多被
 * 平均掉。容差取得紧：判成不同只是多换一次图，判成相同却会让封面停在上一张。按最大差而不是平均差比，
 * 只差一个角标、一行小字的两张图也分得开。
 */
export const COVER_PROBE_SIZE = 32;
export { sameCoverPixels, SAME_COVER_TOLERANCE } from '../../covers/sameCoverPixels.ts';

/**
 * 取一张封面的比对用像素（RGBA）；应答不是 2xx 或拿不到 2d 上下文时答 `null`，请求出错、图解不出时 reject。
 * 走 `fetch` 而不是画 `<img>`：`fb2k://` 的图画进 canvas 会污染它，读不出像素（`coverColor.ts` 的
 * `samplePixels` 同理）。
 */
export async function probeCover(url: string): Promise<Uint8ClampedArray | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob(), {
    resizeWidth: COVER_PROBE_SIZE,
    resizeHeight: COVER_PROBE_SIZE,
    resizeQuality: 'high',
  });
  try {
    const canvas = new OffscreenCanvas(COVER_PROBE_SIZE, COVER_PROBE_SIZE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, COVER_PROBE_SIZE, COVER_PROBE_SIZE).data;
  } finally {
    bitmap.close();
  }
}
