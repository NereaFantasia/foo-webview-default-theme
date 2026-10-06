import { isCoverProfile, type CoverProfile, type CoverSeed } from './coverPalette.ts';
export { seedFromPixels, type CoverSeed } from './coverPalette.ts';

export const SAMPLE_SIZE = 64;

/**
 * 必须 fetch 后解码位图：直接把 fb2k 协议的 img 画进 canvas 会导致像素读取被安全策略拒绝。
 * 非 2xx 或没有上下文时答 null；网络和解码失败时 reject。
 */
export async function samplePixels(
  url: string,
  size = SAMPLE_SIZE,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray<ArrayBuffer> | null> {
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  try {
    signal?.throwIfAborted();
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, size, size);
    return context.getImageData(0, 0, size, size).data;
  } finally {
    bitmap.close();
  }
}

/** Worker 完成或失败后立即释放；超时不能让换曲请求永久悬挂。 */
export async function seedFromUrl(url: string): Promise<CoverSeed | null> {
  const pixels = await samplePixels(url);
  if (!pixels) return null;
  const accent = (await analyzeCoverPixels(pixels)).accent;
  return accent ? { hue: accent.hue, chroma: accent.chroma } : null;
}

/** 输入缓冲会转移给 Worker；需要保留像素时由调用方先复制。 */
export function analyzeCoverPixels(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<CoverProfile> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(new URL('./coverColorWorker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(signal?.reason ?? new Error('封面取色已取消'));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('封面取色超时'));
    }, 10_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      finish();
      const value = event.data;
      if (isCoverProfile(value)) resolve(value);
      else reject(new Error('封面取色结果无效'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('封面取色失败'));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error('封面取色结果无法读取'));
    };
    try {
      worker.postMessage(pixels, [pixels.buffer]);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
