import { expect, onTestFinished, test, vi } from 'vitest';
import {
  createFlowingSurface,
  type FlowInput,
  type FlowMemory,
} from '../../../../src/theme/background/flowingSurface.ts';
import { createFlowMotion } from '../../../../src/theme/background/flowMotion.ts';
import { createFlowRenderer } from '../../../../src/theme/background/flowRenderer.ts';
import { DURATION_MS } from '../../../../src/motion/timing.ts';
import { defer, installImageData } from '../../../fixtures/coverArt.ts';

vi.mock('../../../../src/theme/background/flowRenderer.ts', () => ({
  createFlowRenderer: vi.fn(),
}));

const INPUT: FlowInput = {
  url: 'first',
  base: { argb: 0xff285ac8, hue: 260, chroma: 50, tone: 45 },
  profile: null,
  running: true,
  paused: false,
  reduced: false,
  focused: true,
  scheme: 'dark',
};
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const pixels = (red: number) => new ImageData(new Uint8ClampedArray([red, 60, 70, 255]), 1, 1);

function setup() {
  installImageData();
  vi.useFakeTimers();
  const renders: {
    image: ImageData | null;
    mix: number;
    ended: boolean;
    draws: number;
    scheme: FlowInput['scheme'];
    replace: ReturnType<typeof vi.fn>;
  }[] = [];
  const snapshot = pixels(180);
  vi.mocked(createFlowRenderer).mockImplementation(() => {
    let loaded = false;
    const record = {
      image: null as ImageData | null,
      mix: 1,
      ended: false,
      draws: 0,
      scheme: INPUT.scheme,
      replace: vi.fn(),
    };
    record.replace.mockImplementation((image: ImageData | null) => {
      record.image = image;
      const prior = loaded;
      loaded = true;
      return prior;
    });
    renders.push(record);
    return {
      replace: record.replace,
      draw: (_, mix, scheme) => {
        record.mix = mix;
        record.scheme = scheme;
        record.draws++;
      },
      snapshot: () => snapshot,
      dispose: () => {
        record.ended = true;
      },
    };
  });
  const canvases: {
    dataset: Record<string, string>;
    removed: boolean;
    style: { opacity?: string };
  }[] = [];
  const animations: { cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = {
        dataset: {},
        style: {},
        width: 0,
        height: 0,
        removed: false,
        setAttribute: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        remove: () => {
          canvas.removed = true;
        },
        getContext: () => ({ putImageData: vi.fn() }),
        animate: () => {
          const animation = { finished: Promise.resolve(), cancel: vi.fn() };
          animations.push(animation);
          return animation;
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const draw = (elapsed = 17) => {
    vi.advanceTimersByTime(elapsed);
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(performance.now()));
  };
  const decoded: { pixels: ImageData; close: ReturnType<typeof vi.fn> }[] = [];
  const pending = new Map<string, ReturnType<typeof defer<(typeof decoded)[number]>>>();
  const reads: { url: string; signal: AbortSignal }[] = [];
  vi.stubGlobal('fetch', async (url: string, { signal }: { signal: AbortSignal }) => {
    reads.push({ url, signal });
    return { ok: url !== 'failed', blob: async () => url };
  });
  vi.stubGlobal('createImageBitmap', async (url: string) => {
    const wait = pending.get(url);
    if (wait) return wait.promise;
    const bitmap = { pixels: pixels(url === 'different' ? 210 : 180), close: vi.fn() };
    decoded.push(bitmap);
    return bitmap;
  });
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        let value = snapshot;
        return {
          drawImage: (bitmap: { pixels: ImageData }) => {
            value = bitmap.pixels;
          },
          getImageData: () => value,
        };
      }
    },
  );
  const memory: FlowMemory = {
    motion: createFlowMotion(),
    gpuFailed: false,
    cover: null,
    preview: null,
  };
  const ready = vi.fn();
  const surface = createFlowingSurface({ append: vi.fn() }, memory, ready);
  onTestFinished(() => {
    surface.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  surface.update(INPUT);
  return {
    surface,
    memory,
    renders,
    reads,
    decoded,
    pending,
    frames,
    canvases,
    draw,
    snapshot,
    ready,
    animations,
  };
}

test('短暂空输入保留旧图，同一地址恢复不重读，不同地址同像素不换图', async () => {
  const { surface, memory, renders, reads, decoded, draw } = setup();
  await settle();
  const first = memory.cover?.pixels;
  surface.update({ ...INPUT, url: '', running: false });
  vi.advanceTimersByTime(DURATION_MS.normal - 1);
  expect(renders[0].image).toBe(first);
  surface.update(INPUT);
  vi.advanceTimersByTime(DURATION_MS.normal);
  expect(reads.map((read) => read.url)).toEqual(['first']);
  expect(renders[0].image).toBe(first);
  const uploads = renders[0].replace.mock.calls.length;
  surface.update({ ...INPUT, url: 'same-image' });
  await settle();
  draw();
  expect(memory.cover).toEqual({ url: 'same-image', pixels: first });
  expect(renders[0].replace.mock.calls).toHaveLength(uploads);
  expect(renders[0].mix).toBe(1);
  expect(decoded.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
});

test('真实缺图等待缓冲后渐退，停止最终不再排帧；新封面等待解码而不清旧图', async () => {
  const { surface, memory, renders, frames, pending, draw, canvases } = setup();
  await settle();
  draw();
  const first = memory.cover?.pixels;
  const delayed = defer<{ pixels: ImageData; close: ReturnType<typeof vi.fn> }>();
  pending.set('delayed', delayed);
  surface.update({ ...INPUT, url: 'delayed' });
  await settle();
  expect(renders[0].image).toBe(first);
  delayed.resolve({ pixels: pixels(210), close: vi.fn() });
  await settle();
  draw();
  expect(renders[0].image?.data[0]).toBe(210);
  expect(renders[0].mix).toBe(0);
  surface.update({ ...INPUT, url: '', running: false });
  vi.advanceTimersByTime(DURATION_MS.normal);
  expect(memory.cover).toBeNull();
  expect(canvases[0].style.opacity).toBe('0');
  const draws = renders[0].draws;
  for (let i = 0; i < 20; i++) draw(20);
  expect(renders[0].draws).toBe(draws);
  expect(renders[0].replace.mock.calls.every(([image]) => image !== null)).toBe(true);
  expect(frames.size).toBe(0);
});

test('过期解码关闭位图，失败与超时不接受迟到封面', async () => {
  const { surface, memory, pending, reads } = setup();
  await settle();
  const late = defer<{ pixels: ImageData; close: ReturnType<typeof vi.fn> }>();
  pending.set('old', late);
  surface.update({ ...INPUT, url: 'old' });
  await settle();
  surface.update({ ...INPUT, url: 'different' });
  await settle();
  const bitmap = { pixels: pixels(30), close: vi.fn() };
  late.resolve(bitmap);
  await settle();
  expect(memory.cover?.pixels.data[0]).toBe(210);
  expect(reads.find((read) => read.url === 'old')?.signal.aborted).toBe(true);
  expect(bitmap.close).toHaveBeenCalledOnce();
  surface.update({ ...INPUT, url: 'failed' });
  await settle();
  expect(memory.cover).toBeNull();
  const timeout = defer<typeof bitmap>();
  pending.set('timeout', timeout);
  surface.update({ ...INPUT, url: 'timeout' });
  await settle();
  vi.advanceTimersByTime(10_000);
  const timedOut = { pixels: pixels(50), close: vi.fn() };
  timeout.resolve(timedOut);
  await settle();
  expect(memory.cover).toBeNull();
  expect(timedOut.close).toHaveBeenCalledOnce();
});

test('休眠回收绘制和请求，只保留当前像素与预览；恢复不重复读取同图', async () => {
  const { surface, memory, renders, reads, frames, canvases, snapshot, draw } = setup();
  await settle();
  draw();
  const cover = memory.cover;
  const motion = memory.motion.time;
  surface.suspend();
  expect(renders[0].ended).toBe(true);
  expect(frames.size).toBe(0);
  expect(memory.preview).toEqual({ pixels: snapshot, scheme: 'dark' });
  expect(memory.cover).toBe(cover);
  expect(canvases.filter((canvas) => !canvas.removed).map((canvas) => canvas.dataset)).toEqual([
    { flowPreview: '' },
  ]);
  vi.advanceTimersByTime(60_000);
  surface.update(INPUT);
  draw();
  await settle();
  expect(renders[1].image).toBe(cover?.pixels);
  expect(reads.map((read) => read.url)).toEqual(['first']);
  expect(memory.motion.time).toBe(motion);
  expect(canvases.filter((canvas) => !canvas.removed).map((canvas) => canvas.dataset)).toEqual([
    { paletteField: '', flowBackend: 'webgl2' },
  ]);
  surface.dispose();
  expect(frames.size).toBe(0);
  expect(canvases.every((canvas) => canvas.removed)).toBe(true);
  expect(renders.every((render) => render.ended)).toBe(true);
});

test('休眠取消未完成的解码，恢复可改用最新封面，缓存不积累', async () => {
  const { surface, memory, pending, reads, renders } = setup();
  await settle();
  const delayed = defer<{ pixels: ImageData; close: ReturnType<typeof vi.fn> }>();
  pending.set('delayed', delayed);
  surface.update({ ...INPUT, url: 'delayed' });
  await settle();
  surface.suspend();
  expect(reads.at(-1)?.signal.aborted).toBe(true);
  surface.update({ ...INPUT, url: 'different' });
  await settle();
  const bitmap = { pixels: pixels(30), close: vi.fn() };
  delayed.resolve(bitmap);
  await settle();
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(memory.cover?.url).toBe('different');
  expect(renders.at(-1)?.image?.data[0]).toBe(210);
});

test('主题切换同步呈色，不重读封面、重建GPU或重置运动', async () => {
  const { surface, memory, renders, reads } = setup();
  await settle();
  const cover = memory.cover;
  memory.motion.time = 7;
  surface.update({ ...INPUT, scheme: 'light' });
  expect(renders).toHaveLength(1);
  expect(renders[0].scheme).toBe('light');
  expect(renders[0].image).toBe(cover?.pixels);
  expect(reads.map((read) => read.url)).toEqual(['first']);
  expect(memory.motion.time).toBe(7);
  surface.update(INPUT);
  expect(renders[0].scheme).toBe('dark');
  expect(memory.cover).toBe(cover);
});

test('休眠中换主题撤下旧主题预览，恢复直接用缓存画出当前主题', async () => {
  const { surface, memory, renders, reads, canvases, frames, draw } = setup();
  await settle();
  draw();
  const cover = memory.cover;
  surface.suspend();
  expect(memory.preview?.scheme).toBe('dark');
  surface.suspend('light');
  expect(memory.preview).toBeNull();
  expect(canvases.every((canvas) => canvas.removed)).toBe(true);
  expect(frames.size).toBe(0);
  surface.update({ ...INPUT, scheme: 'light' });
  expect(renders.at(-1)?.scheme).toBe('light');
  expect(renders.at(-1)?.image).toBe(cover?.pixels);
  expect(reads).toHaveLength(1);
});

test('进入时等封面首帧才宣布就绪，停止后补到封面直接绘制新图再淡入', async () => {
  const { surface, ready, draw, renders, canvases } = setup();
  expect(ready).not.toHaveBeenCalled();
  await settle();
  expect(ready).not.toHaveBeenCalled();
  draw();
  expect(ready).toHaveBeenCalledOnce();
  expect(renders[0].image?.data[0]).toBe(180);
  surface.update({ ...INPUT, url: '', running: false });
  vi.advanceTimersByTime(DURATION_MS.normal);
  for (let i = 0; i < 20; i++) draw(20);
  surface.update(INPUT);
  expect(canvases[0].style.opacity).toBe('0');
  await settle();
  draw();
  expect(renders[0].mix).toBe(1);
  expect(canvases[0].style.opacity).toBe('1');
  expect(ready).toHaveBeenCalledOnce();
});

test('无预览恢复时淡入，途中启用减弱动效会清除动画并停止持续排帧', async () => {
  const { surface, draw, animations, frames } = setup();
  await settle();
  draw();
  surface.suspend('light');
  surface.update({ ...INPUT, scheme: 'light' });
  const animation = animations.at(-1);
  expect(animation).toBeDefined();
  expect(animation?.cancel).not.toHaveBeenCalled();
  surface.update({ ...INPUT, scheme: 'light', reduced: true });
  expect(animation?.cancel).toHaveBeenCalledOnce();
  draw();
  expect(frames.size).toBe(0);
});

test('停止后的隐藏恢复不缓存或复活旧封面，改变基础强调色仍保持中性底', async () => {
  const { surface, memory, canvases, renders, draw, frames, reads } = setup();
  await settle();
  draw();
  const stopped = { ...INPUT, url: '', running: false };
  surface.update(stopped);
  vi.advanceTimersByTime(DURATION_MS.normal);
  draw();
  expect(canvases[0].style.opacity).toBe('0');
  surface.suspend();
  expect(memory.cover).toBeNull();
  expect(memory.preview).toBeNull();
  expect(canvases.every((canvas) => canvas.removed)).toBe(true);
  surface.update({ ...stopped, base: { ...INPUT.base, argb: 0xffff0000 } });
  draw();
  expect(canvases.at(-1)?.style.opacity).toBe('0');
  expect(renders.at(-1)?.draws).toBe(0);
  expect(frames.size).toBe(0);
  expect(reads).toHaveLength(1);
});

test('GPU不可用且无封面时静态回退也保持透明，不绘制基础强调色', async () => {
  const { surface, memory, canvases, draw, frames } = setup();
  await settle();
  draw();
  surface.suspend();
  memory.gpuFailed = true;
  surface.update({ ...INPUT, url: '', profile: null, running: false });
  expect(canvases.at(-1)?.dataset.flowBackend).toBe('static');
  expect(canvases.at(-1)?.style.opacity).toBe('0');
  expect(memory.cover).toBeNull();
  expect(memory.preview).toBeNull();
  expect(frames.size).toBe(0);
});

test('在隐藏期间停止播放，恢复时不重绘旧封面或等待再次退色', async () => {
  const { surface, memory, draw, canvases, renders } = setup();
  await settle();
  draw();
  surface.suspend('dark');
  expect(memory.cover).not.toBeNull();
  expect(memory.preview).not.toBeNull();
  surface.suspend('dark', true);
  expect(memory.cover).toBeNull();
  expect(memory.preview).toBeNull();
  expect(canvases.every((canvas) => canvas.removed)).toBe(true);
  surface.update({ ...INPUT, url: '', running: false });
  draw();
  expect(canvases.at(-1)?.style.opacity).toBe('0');
  expect(renders.at(-1)?.draws).toBe(0);
});
