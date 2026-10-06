import { expect, onTestFinished, test, vi } from 'vitest';
import { isCoverProfile } from '../../../src/theme/coverPalette.ts';

test('Worker 固定量化初值，重复输入稳定，结束后恢复随机源', async () => {
  let handle: ((event: { data: unknown }) => void) | undefined;
  vi.stubGlobal('addEventListener', (_name: string, listener: typeof handle) => {
    handle = listener;
  });
  const results: unknown[] = [];
  vi.stubGlobal('postMessage', (value: unknown) => results.push(value));
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  await import('../../../src/theme/coverColorWorker.ts');
  expect(handle).toBeTypeOf('function');
  const pixels = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, at) =>
    at % 4 === 3 ? 255 : (Math.imul(at, 31) + (at >> 4)) % 256,
  );
  const random = Math.random;
  handle?.({ data: pixels });
  expect(Math.random).toBe(random);
  handle?.({ data: pixels });
  expect(Math.random).toBe(random);
  expect(results).toHaveLength(2);
  expect(results[0]).not.toBeNull();
  expect(isCoverProfile(results[0])).toBe(true);
  expect(results[0]).toEqual(results[1]);
  expect(() => handle?.({ data: 'bad' })).toThrow('封面像素无效');
  expect(Math.random).toBe(random);
});
