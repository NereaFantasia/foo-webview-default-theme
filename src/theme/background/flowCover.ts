/** 流动渲染器吃的封面像素边长；渲染器内部的纹理就是这个尺寸 */
export const FLOW_COVER_SIZE = 512;

/**
 * 取封面并缩成流动渲染器要的方形像素：先 `fetch` 地址、解码时直接缩到边长，再画进离屏 canvas 读出
 * 宿主的封面协议与网易云 CDN 都回 `Access-Control-Allow-Origin: *`，读像素不会污染 canvas。
 * 请求被取消、地址读不到、解码失败都抛错，由调用方决定留着上一张还是退回中性色
 */
export async function loadFlowCover(url: string, signal: AbortSignal): Promise<ImageData> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('背景封面读取失败');
  const bitmap = await createImageBitmap(await response.blob(), {
    resizeWidth: FLOW_COVER_SIZE,
    resizeHeight: FLOW_COVER_SIZE,
    resizeQuality: 'high',
  });
  try {
    const sample = new OffscreenCanvas(FLOW_COVER_SIZE, FLOW_COVER_SIZE);
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取背景封面像素');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, FLOW_COVER_SIZE, FLOW_COVER_SIZE);
  } finally {
    bitmap.close();
  }
}
