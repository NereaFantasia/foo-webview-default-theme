import { expect, onTestFinished, test, vi } from 'vitest';
import { createCoverAnalysis } from '../../../src/covers/coverAnalysis.ts';
import { profileFromPixels } from '../../../src/theme/coverPalette.ts';
import { defer } from '../../fixtures/coverArt.ts';

const pixels = (red = 40) => new Uint8ClampedArray([red, 90, 200, 255]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('同地址并发合并，不同地址同图复用档案；同地址换图重新分析', async () => {
  let image = pixels();
  const sample = vi.fn(async () => image.slice());
  const analyze = vi.fn(async (data: Uint8ClampedArray) => profileFromPixels(data));
  const service = createCoverAnalysis({ sample, analyze });
  onTestFinished(() => service.dispose());
  const first = service.read('a');
  expect(service.read('a')).toBe(first);
  const profile = await first;
  expect(await service.read('b')).toBe(profile);
  expect(sample).toHaveBeenCalledTimes(2);
  expect(analyze).toHaveBeenCalledTimes(1);
  image = pixels(41);
  expect(await service.read('a')).not.toBe(profile);
  expect(analyze).toHaveBeenCalledTimes(2);
});

test('读取失败和无图不缓存，分析失败后也可重试', async () => {
  const sample = vi
    .fn()
    .mockRejectedValueOnce(new Error('fetch'))
    .mockResolvedValueOnce(null)
    .mockImplementation(async () => pixels());
  const analyze = vi
    .fn()
    .mockRejectedValueOnce(new Error('worker'))
    .mockImplementation(async (data: Uint8ClampedArray) => profileFromPixels(data));
  const service = createCoverAnalysis({ sample, analyze });
  onTestFinished(() => service.dispose());
  await expect(service.read('a')).rejects.toThrow('fetch');
  await expect(service.read('a')).resolves.toBeNull();
  await expect(service.read('a')).rejects.toThrow('worker');
  expect((await service.read('a'))?.accent).not.toBeNull();
  expect(analyze).toHaveBeenCalledTimes(2);
});

test('缓存只保留最近 32 份，并在命中时更新顺序', async () => {
  const sample = vi.fn(async (url: string) => pixels(Number(url)));
  const analyze = vi.fn(async (data: Uint8ClampedArray) => profileFromPixels(data));
  const service = createCoverAnalysis({ sample, analyze });
  onTestFinished(() => service.dispose());
  const first = await service.read('0');
  for (let index = 1; index < 32; index += 1) await service.read(String(index));
  expect(await service.read('0')).toBe(first);
  await service.read('32');
  expect(await service.read('0')).toBe(first);
  expect(analyze).toHaveBeenCalledTimes(33);
  await service.read('1');
  expect(analyze).toHaveBeenCalledTimes(34);
});

test('串行分析且队列有界，释放时中止当前读取并拒绝排队请求', async () => {
  const gate = defer<Uint8ClampedArray<ArrayBuffer> | null>();
  const signals: AbortSignal[] = [];
  const sample = vi.fn((_url: string, signal: AbortSignal) => {
    signals.push(signal);
    return gate.promise;
  });
  const analyze = vi.fn(async (data: Uint8ClampedArray) => profileFromPixels(data));
  const service = createCoverAnalysis({ sample, analyze });
  const pending = Array.from({ length: 32 }, (_, at) => service.read(String(at)));
  const settled = Promise.allSettled(pending);
  await expect(service.read('overflow')).rejects.toThrow('队列已满');
  await flush();
  expect(sample).toHaveBeenCalledTimes(1);
  service.dispose();
  expect(signals[0].aborted).toBe(true);
  gate.resolve(pixels());
  expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
  expect(analyze).not.toHaveBeenCalled();
  await expect(service.read('a')).rejects.toThrow('已停止');
});

test('分析途中释放不发布迟到结果', async () => {
  const gate = defer<ReturnType<typeof profileFromPixels>>();
  const service = createCoverAnalysis({
    sample: async () => pixels(),
    analyze: () => gate.promise,
  });
  const pending = expect(service.read('a')).rejects.toThrow('已停止');
  await flush();
  service.dispose();
  gate.resolve(profileFromPixels(pixels()));
  await pending;
});

test('灰图的档案也可复用，不把它当作失败反复量化', async () => {
  const analyze = vi.fn(async (data: Uint8ClampedArray) => profileFromPixels(data));
  const service = createCoverAnalysis({
    sample: async () => new Uint8ClampedArray([128, 128, 128, 255]),
    analyze,
  });
  onTestFinished(() => service.dispose());
  const first = await service.read('a');
  expect(first?.gray).toBe(true);
  expect(await service.read('b')).toBe(first);
  expect(analyze).toHaveBeenCalledOnce();
});

test('读取超时会中止信号，后续请求仍能继续', async () => {
  vi.useFakeTimers();
  const sample = (url: string, signal: AbortSignal) =>
    url === 'slow'
      ? new Promise<Uint8ClampedArray<ArrayBuffer>>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
      : Promise.resolve(pixels());
  const service = createCoverAnalysis({
    sample,
    analyze: async (data) => profileFromPixels(data),
  });
  onTestFinished(() => {
    service.dispose();
    vi.useRealTimers();
  });
  const slow = expect(service.read('slow')).rejects.toThrow('超时');
  const next = service.read('next');
  await vi.advanceTimersByTimeAsync(10_000);
  await slow;
  expect((await next)?.accent).not.toBeNull();
});
