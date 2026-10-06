import { describe, expect, onTestFinished, test, vi } from 'vitest';
import {
  SAMPLE_SIZE,
  analyzeCoverPixels,
  samplePixels,
  seedFromPixels,
  seedFromUrl,
} from '../../../src/theme/coverColor.ts';
import { argbFromRgb, Hct } from '@material/material-color-utilities';
import { stubColorWorker } from '../../fixtures/colorWorker.ts';

/** 按 [r,g,b] 铺满一张 n 像素的 RGBA 缓冲；`alpha` 给 0 可以造透明区。 */
function fill(rgb: [number, number, number], count: number, alpha = 255): number[] {
  return Array.from({ length: count }, () => [rgb[0], rgb[1], rgb[2], alpha]).flat();
}
const pixels = (...parts: number[][]) => new Uint8ClampedArray(parts.flat());

describe('seedFromPixels', () => {
  test('灰底面积更大时仍能选出蓝色强调色', () => {
    const seed = seedFromPixels(pixels(fill([128, 128, 128], 60), fill([40, 90, 200], 40)));
    expect(seed).not.toBeNull();
    const hue = seed?.hue ?? NaN;
    expect(Math.abs(hue - Hct.fromInt(argbFromRgb(40, 90, 200)).hue), `色相 ${hue}`).toBeLessThan(
      8,
    );
    expect(seed?.chroma).toBeGreaterThan(8);
  });

  test('判灰：整张都是低彩度就不取色', () => {
    expect(seedFromPixels(pixels(fill([120, 122, 125], 100)))).toBeNull();
    expect(seedFromPixels(pixels(fill([255, 255, 255], 100)))).toBeNull();
  });

  test('低于面积门槛的强色和全透明图没有强调色', () => {
    expect(
      seedFromPixels(pixels(fill([0, 0, 0], 49), fill([255, 255, 255], 49), fill([255, 0, 0], 2))),
    ).toBeNull();
    // 全透明等于没有像素。
    expect(seedFromPixels(pixels(fill([200, 30, 30], 50, 0)))).toBeNull();
    expect(seedFromPixels(new Uint8ClampedArray(0))).toBeNull();
  });

  test('相近的两团红色仍选出红色候选', () => {
    const seed = seedFromPixels(pixels(fill([200, 40, 60], 50), fill([200, 90, 30], 50)));
    expect(seed).not.toBeNull();
    const hue = seed?.hue ?? NaN;
    expect(hue < 60 || hue > 330, `色相 ${hue}`).toBe(true);
  });
});

interface CanvasStub {
  /** `drawImage` 收到的参数。 */
  readonly drawn: unknown[][];
  /** 建过的画布尺寸与 `getContext` 的参数。 */
  readonly canvases: { width: number; height: number; context: unknown[] }[];
  readonly closed: () => number;
  readonly fetched: string[];
}

/** 换掉 `fetch`、`createImageBitmap` 与 `OffscreenCanvas`；`getImageData` 答 `data`。 */
function stubCanvas(options: {
  status?: number;
  context?: boolean;
  data?: Uint8ClampedArray;
  decode?: 'fail';
}): CanvasStub {
  const drawn: unknown[][] = [];
  const canvases: CanvasStub['canvases'] = [];
  const fetched: string[] = [];
  let closed = 0;
  const bitmap = { close: () => (closed += 1) };
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return new Response('image', { status: options.status ?? 200 });
  });
  vi.stubGlobal('createImageBitmap', async () => {
    if (options.decode === 'fail') throw new Error('decode failed');
    return bitmap;
  });
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext(...args: unknown[]) {
        canvases.push({ width: this.width, height: this.height, context: args });
        if (options.context === false) return null;
        return {
          drawImage: (...drawArgs: unknown[]) => drawn.push(drawArgs),
          getImageData: (_x: number, _y: number, width: number, height: number) => ({
            data: options.data ?? new Uint8ClampedArray(width * height * 4),
          }),
        };
      }
    },
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return { drawn, canvases, fetched, closed: () => closed };
}

describe('samplePixels', () => {
  test('同一个地址 fetch 成位图，画进 size 见方的画布再读出像素，位图随即关掉', async () => {
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(7);
    const stub = stubCanvas({ data });
    await expect(samplePixels('fb2k://artwork/?path=a', 8)).resolves.toBe(data);
    expect(stub.fetched).toStrictEqual(['fb2k://artwork/?path=a']);
    expect(stub.canvases).toStrictEqual([
      { width: 8, height: 8, context: ['2d', { willReadFrequently: true }] },
    ]);
    expect(stub.drawn).toHaveLength(1);
    expect(stub.drawn[0]?.slice(1)).toStrictEqual([0, 0, 8, 8]);
    expect(stub.closed()).toBe(1);
  });

  test('缺省按 SAMPLE_SIZE 取样', async () => {
    const stub = stubCanvas({});
    const sampled = await samplePixels('u');
    expect(sampled?.length).toBe(SAMPLE_SIZE * SAMPLE_SIZE * 4);
    expect(stub.canvases[0]?.width).toBe(SAMPLE_SIZE);
  });

  test('应答不是 2xx 答 null，不解码', async () => {
    const stub = stubCanvas({ status: 404 });
    await expect(samplePixels('u')).resolves.toBeNull();
    expect(stub.canvases).toStrictEqual([]);
  });

  test('拿不到 2d 上下文答 null，位图照样关掉；解码失败时 reject', async () => {
    const stub = stubCanvas({ context: false });
    await expect(samplePixels('u')).resolves.toBeNull();
    expect(stub.closed()).toBe(1);

    stubCanvas({ decode: 'fail' });
    await expect(samplePixels('u')).rejects.toThrow('decode failed');
  });
});

describe('seedFromUrl', () => {
  test('取样成功就按像素挑色，地址读不到时没有种子色', async () => {
    const data = pixels(fill([40, 90, 200], SAMPLE_SIZE * SAMPLE_SIZE));
    stubColorWorker();
    stubCanvas({ data });
    await expect(seedFromUrl('u')).resolves.toStrictEqual(seedFromPixels(data));

    stubCanvas({ status: 500 });
    await expect(seedFromUrl('u')).resolves.toBeNull();
  });
});

test('近黑噪声无强调色，亮黄色不因明度高被排除', () => {
  expect(seedFromPixels(pixels(fill([1, 0, 1], 100)))).toBeNull();
  expect(seedFromPixels(pixels(fill([255, 255, 0], 100)))).not.toBeNull();
});

test('透明区域不稀释有效像素面积，5% 的强色可以入选', () => {
  expect(seedFromPixels(pixels(fill([255, 0, 0], 5), fill([128, 128, 128], 95)))).not.toBeNull();
  expect(
    seedFromPixels(pixels(fill([255, 0, 0], 5), fill([128, 128, 128], 95, 127))),
  ).not.toBeNull();
});

test.each(['error', 'messageerror', 'invalid', 'post'] as const)(
  'Worker %s 失败会释放资源并拒绝请求',
  async (mode) => {
    stubCanvas({ data: pixels(fill([40, 90, 200], 100)) });
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        onmessageerror: (() => void) | null = null;
        terminate = terminate;
        postMessage() {
          if (mode === 'post') throw new Error('post failed');
          if (mode === 'error') this.onerror?.();
          if (mode === 'messageerror') this.onmessageerror?.();
          if (mode === 'invalid') this.onmessage?.({ data: { hue: NaN, chroma: 20 } });
        }
      },
    );
    await expect(seedFromUrl('u')).rejects.toThrow();
    expect(terminate).toHaveBeenCalledOnce();
  },
);

test('Worker 无应答时超时释放，不留下永久挂起的请求', async () => {
  stubCanvas({ data: pixels(fill([40, 90, 200], 100)) });
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const terminate = vi.fn();
  vi.stubGlobal(
    'Worker',
    class {
      terminate = terminate;
      postMessage() {}
    },
  );
  const pending = expect(seedFromUrl('u')).rejects.toThrow('封面取色超时');
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(terminate).toHaveBeenCalledOnce();
});

test('取消进行中的像素分析立即释放 Worker；已取消的请求不启动 Worker', async () => {
  const terminate = vi.fn();
  const constructed = vi.fn();
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        constructed();
      }
      terminate = terminate;
      postMessage() {}
    },
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const controller = new AbortController();
  const pending = expect(
    analyzeCoverPixels(new Uint8ClampedArray(4), controller.signal),
  ).rejects.toThrow('cancel');
  controller.abort(new Error('cancel'));
  await pending;
  expect(terminate).toHaveBeenCalledOnce();
  await expect(analyzeCoverPixels(new Uint8ClampedArray(4), controller.signal)).rejects.toThrow(
    'cancel',
  );
  expect(constructed).toHaveBeenCalledOnce();
});
