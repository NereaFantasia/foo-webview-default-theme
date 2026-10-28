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

test('读成功的档案按地址记下供 peek，forget 清掉；读不到图的不记，read 仍不凭地址复用', async () => {
  const sample = vi.fn(async (url: string) => (url === 'none' ? null : pixels()));
  const service = createCoverAnalysis({
    sample,
    analyze: async (data) => profileFromPixels(data),
  });
  onTestFinished(() => service.dispose());
  expect(service.peek('a')).toBeUndefined();
  const profile = await service.read('a');
  expect(service.peek('a')).toBe(profile);
  await service.read('none');
  expect(service.peek('none')).toBeUndefined();
  service.forget();
  expect(service.peek('a')).toBeUndefined();
  await service.read('a');
  expect(sample).toHaveBeenCalledTimes(3);
});

test('按地址记的档案留最近 512 份，peek 命中也算最近用过', async () => {
  const service = createCoverAnalysis({
    sample: async () => pixels(),
    analyze: async (data) => profileFromPixels(data),
  });
  onTestFinished(() => service.dispose());
  for (let index = 0; index < 512; index += 1) await service.read(String(index));
  expect(service.peek('0')).toBeDefined();
  await service.read('512');
  expect(service.peek('0')).toBeDefined();
  expect(service.peek('1')).toBeUndefined();
  expect(service.peek('512')).toBeDefined();
});

test('读取者都中止后，没开始的排队请求不再采样；有人还要就留着', async () => {
  const gate = defer<Uint8ClampedArray<ArrayBuffer> | null>();
  const sample = vi.fn((url: string) =>
    url === 'busy' ? gate.promise : Promise.resolve(pixels()),
  );
  const service = createCoverAnalysis({
    sample,
    analyze: async (data) => profileFromPixels(data),
  });
  onTestFinished(() => service.dispose());
  const busy = service.read('busy');
  await flush();
  const first = new AbortController();
  const second = new AbortController();
  const dropped = service.read('dropped', first.signal);
  const droppedRejected = expect(dropped).rejects.toThrow('已取消');
  service.read('shared', first.signal);
  const shared = service.read('shared', second.signal);
  first.abort();
  gate.resolve(pixels());
  await busy;
  await droppedRejected;
  expect(await shared).not.toBeNull();
  expect(sample.mock.calls.map(([url]) => url)).toEqual(['busy', 'shared']);
  second.abort();
});

test('已开始的请求不因读取者中止而放弃，档案照样记下', async () => {
  const gate = defer<Uint8ClampedArray<ArrayBuffer> | null>();
  const service = createCoverAnalysis({
    sample: () => gate.promise,
    analyze: async (data) => profileFromPixels(data),
  });
  onTestFinished(() => service.dispose());
  const reader = new AbortController();
  const reading = service.read('a', reader.signal);
  await flush();
  reader.abort();
  gate.resolve(pixels());
  expect(service.peek('a')).toBeUndefined();
  expect(await reading).not.toBeNull();
  expect(service.peek('a')).toBe(await reading);
});

test('作废的请求让位给同地址后来的读取，收尾时不把新的摘掉；已中止的信号不排队', async () => {
  const busy = defer<Uint8ClampedArray<ArrayBuffer> | null>();
  const next = defer<Uint8ClampedArray<ArrayBuffer> | null>();
  const sample = vi.fn((url: string) => (url === 'busy' ? busy.promise : next.promise));
  const service = createCoverAnalysis({
    sample,
    analyze: async (data) => profileFromPixels(data),
  });
  onTestFinished(() => service.dispose());
  const holding = service.read('busy');
  await flush();
  const left = new AbortController();
  const old = service.read('a', left.signal);
  const oldRejected = expect(old).rejects.toThrow('已取消');
  left.abort();
  const again = service.read('a');
  expect(again).not.toBe(old);
  const aborted = AbortSignal.abort(new Error('不要了'));
  await expect(service.read('b', aborted)).rejects.toThrow('不要了');
  busy.resolve(pixels());
  await holding;
  await oldRejected;
  expect(service.read('a')).toBe(again);
  next.resolve(pixels());
  expect(await again).not.toBeNull();
  expect(sample.mock.calls.map(([url]) => url)).toEqual(['busy', 'a']);
});

test('作废的请求不占队列名额', async () => {
  const gate = defer<Uint8ClampedArray<ArrayBuffer> | null>();
  const service = createCoverAnalysis({
    sample: () => gate.promise,
    analyze: async (data) => profileFromPixels(data),
  });
  onTestFinished(() => service.dispose());
  const busy = service.read('busy');
  const left = new AbortController();
  const rejected = Array.from({ length: 31 }, (_, at) =>
    expect(service.read(String(at), left.signal)).rejects.toThrow('已取消'),
  );
  await expect(service.read('overflow')).rejects.toThrow('队列已满');
  left.abort();
  const fresh = service.read('fresh');
  gate.resolve(pixels());
  await busy;
  await Promise.all(rejected);
  expect(await fresh).not.toBeNull();
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
