import type { MetadataWriteCompletePayload } from 'foo-webview-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTagWrites } from '../../../src/track/tagWrites.ts';

const FILE = 'e:\\music\\live.flac';

function completed(path: string, subsong: number, success: boolean): MetadataWriteCompletePayload {
  return {
    operation: 'write',
    path,
    subsong,
    code: success ? 0 : 2,
    success,
    status: success ? 'success' : 'error',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createTagWrites', () => {
  it('按文件与 subsong 触发补读，不采用事件中的成功标记', async () => {
    const writes = createTagWrites(3000);
    const first = writes.expect(FILE, 1, async () => true);
    const second = writes.expect(FILE, 2, async () => true);
    writes.deliver(completed('file://E:\\Music\\Live.flac', 2, false));
    writes.deliver(completed('E:/Music/Live.flac|subsong:1', 1, true));
    expect(await second.done).toBe(true);
    expect(await first.done).toBe(true);
  });

  it('同一处的两次写入分别核实自己的目标值', async () => {
    vi.useFakeTimers();
    const writes = createTagWrites(3000);
    const earlier = writes.expect(FILE, 0, async () => false);
    const later = writes.expect(FILE, 0, async () => true);
    writes.deliver(completed(FILE, 0, true));
    await vi.advanceTimersByTimeAsync(3000);
    expect([await earlier.done, await later.done]).toEqual([false, true]);
  });

  it('撤掉的与释放时还在等的答 null，之后的事件不再交给它们', async () => {
    const writes = createTagWrites(3000);
    const verify = vi.fn(async () => true);
    const cancelled = writes.expect(FILE, 1, verify);
    const pending = writes.expect(FILE, 2, verify);
    cancelled.cancel();
    writes.deliver(completed(FILE, 1, false));
    writes.dispose();
    writes.deliver(completed(FILE, 2, false));
    expect(await cancelled.done).toBeNull();
    expect(await pending.done).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it('事件缺失时到时限补读，读取失败答 null', async () => {
    vi.useFakeTimers();
    const writes = createTagWrites(3000);
    const wait = writes.expect(FILE, 0, async () => null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await wait.done).toBeNull();
  });

  it('旧写入超时后迟到的成功事件不能确认新目标', async () => {
    vi.useFakeTimers();
    const writes = createTagWrites(3000);
    const old = writes.expect(FILE, 0, async () => null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await old.done).toBeNull();
    let value = 'old';
    let result: boolean | null | undefined;
    const next = writes.expect(FILE, 0, async () => value === 'new');
    void next.done.then((written) => {
      result = written;
    });
    writes.deliver(completed(FILE, 0, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBeUndefined();
    value = 'new';
    writes.deliver(completed(FILE, 0, true));
    expect(await next.done).toBe(true);
  });

  it('两个服务收到同一广播时，只确认补读已达到目标的服务', async () => {
    vi.useFakeTimers();
    const ratings = createTagWrites(3000);
    const artists = createTagWrites(3000);
    const rating = ratings.expect(FILE, 0, async () => true);
    const artist = artists.expect(FILE, 0, async () => false);
    ratings.deliver(completed(FILE, 0, true));
    artists.deliver(completed(FILE, 0, true));
    await vi.advanceTimersByTimeAsync(3000);
    expect([await rating.done, await artist.done]).toEqual([true, false]);
  });

  it('补读途中又有完成事件时，不用旧快照确认', async () => {
    vi.useFakeTimers();
    const writes = createTagWrites(3000);
    let release: (value: boolean) => void = () => {};
    const reading = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const verify = vi
      .fn<() => Promise<boolean | null>>()
      .mockReturnValueOnce(reading)
      .mockResolvedValue(false);
    const wait = writes.expect(FILE, 0, verify);
    writes.deliver(completed(FILE, 0, true));
    await vi.advanceTimersByTimeAsync(0);
    writes.deliver(completed(FILE, 0, true));
    release(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await wait.done).toBe(false);
  });
});
