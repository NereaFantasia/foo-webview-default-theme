import { describe, expect, onTestFinished, test, vi } from 'vitest';
import {
  COVER_PROBE_SIZE,
  probeCover,
  SAME_COVER_TOLERANCE,
  sameCoverPixels,
} from '../../../../src/immersive/cover/coverIdentity.ts';

describe('sameCoverPixels', () => {
  test('逐位相同、差在容差以内都算同一张；超出一级就不是', () => {
    const base = Uint8ClampedArray.from({ length: 16 }, (_, index) => index * 10);
    expect(sameCoverPixels(base, Uint8ClampedArray.from(base))).toBe(true);
    const near = Uint8ClampedArray.from(base);
    near[3] = (near[3] ?? 0) + SAME_COVER_TOLERANCE;
    expect(sameCoverPixels(base, near)).toBe(true);
    const off = Uint8ClampedArray.from(base);
    off[3] = (off[3] ?? 0) + SAME_COVER_TOLERANCE + 1;
    expect(sameCoverPixels(base, off), '只差一格也分得开').toBe(false);
  });

  test('长度不同或为空：不算同一张', () => {
    expect(sameCoverPixels([1, 2, 3, 4], [1, 2, 3])).toBe(false);
    expect(sameCoverPixels([], [])).toBe(false);
  });
});

interface ProbeStub {
  readonly fetched: string[];
  /** `createImageBitmap` 收到的缩放选项。 */
  readonly resized: unknown[];
  /** `drawImage` 收到的参数，位图之后的那几个。 */
  readonly drawn: unknown[][];
  readonly canvases: { width: number; height: number; context: unknown[] }[];
  readonly closed: () => number;
}

/** 换掉 `fetch`、`createImageBitmap` 与 `OffscreenCanvas`；`getImageData` 按读的尺寸答一块填 7 的像素。 */
function stubCanvas(options: { status?: number; context?: boolean; decode?: 'fail' }): ProbeStub {
  const stub = {
    fetched: [] as string[],
    resized: [] as unknown[],
    drawn: [] as unknown[][],
    canvases: [] as ProbeStub['canvases'],
  };
  let closed = 0;
  const bitmap = { close: () => (closed += 1) };
  vi.stubGlobal('fetch', async (url: string) => {
    stub.fetched.push(url);
    return new Response('image', { status: options.status ?? 200 });
  });
  vi.stubGlobal('createImageBitmap', async (_blob: Blob, resize: unknown) => {
    stub.resized.push(resize);
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
        stub.canvases.push({ width: this.width, height: this.height, context: args });
        if (options.context === false) return null;
        return {
          drawImage: (_image: unknown, ...rest: unknown[]) => stub.drawn.push(rest),
          getImageData: (_x: number, _y: number, width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4).fill(7),
          }),
        };
      }
    },
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return { ...stub, closed: () => closed };
}

describe('probeCover', () => {
  test('同一个地址 fetch 成位图，解码时就高质量缩到 32 见方，原样画进画布读出像素，位图随即关掉', async () => {
    const stub = stubCanvas({});
    const pixels = await probeCover('fb2k://artwork/?path=a');
    expect(pixels).toStrictEqual(
      new Uint8ClampedArray(COVER_PROBE_SIZE * COVER_PROBE_SIZE * 4).fill(7),
    );
    expect(COVER_PROBE_SIZE).toBe(32);
    expect(stub.fetched).toStrictEqual(['fb2k://artwork/?path=a']);
    expect(stub.resized).toStrictEqual([
      { resizeWidth: 32, resizeHeight: 32, resizeQuality: 'high' },
    ]);
    expect(stub.canvases).toStrictEqual([
      { width: 32, height: 32, context: ['2d', { willReadFrequently: true }] },
    ]);
    expect(stub.drawn).toStrictEqual([[0, 0]]);
    expect(stub.closed()).toBe(1);
  });

  test('应答不是 2xx 答 null，不解码', async () => {
    const stub = stubCanvas({ status: 404 });
    await expect(probeCover('u')).resolves.toBeNull();
    expect(stub.resized).toStrictEqual([]);
  });

  test('拿不到 2d 上下文答 null，位图照样关掉；解码失败时 reject', async () => {
    const stub = stubCanvas({ context: false });
    await expect(probeCover('u')).resolves.toBeNull();
    expect(stub.closed()).toBe(1);
    stubCanvas({ decode: 'fail' });
    await expect(probeCover('u')).rejects.toThrow('decode failed');
  });
});
