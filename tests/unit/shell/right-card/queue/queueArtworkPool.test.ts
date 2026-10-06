import { describe, expect, it, vi } from 'vitest';
import {
  createQueueArtworkPool,
  type QueueImageIO,
} from '../../../../../src/shell/right-card/queue/queueArtworkPool.ts';

function setup(read: QueueImageIO['read'] = async (url) => new Blob([url])) {
  let index = 0;
  const io: QueueImageIO = { read, create: vi.fn(() => `blob:${++index}`), revoke: vi.fn() };
  return { io, pool: createQueueArtworkPool(io) };
}

describe('队列封面内容池', () => {
  it('不同路径内容相同共用地址；不同内容保持独立', async () => {
    const { pool, io } = setup(
      async (url) => new Blob([url === 'different' ? '另一张封面' : '同一张封面']),
    );
    const first = await pool.load('a');
    expect(await pool.load('b')).toBe(first);
    expect(await pool.load('different')).not.toBe(first);
    expect(io.create).toHaveBeenCalledTimes(2);
    pool.dispose();
    expect(io.revoke).toHaveBeenCalledTimes(2);
  });

  it('超过图片数预算时回收旧图，可见引用仍保留', async () => {
    const { pool, io } = setup();
    const first = await pool.load('0');
    if (!first) throw new Error('缺图');
    for (let i = 1; i <= 64; i++) await pool.load(String(i));
    expect(pool.trim(new Set([first]))).toEqual(['blob:2']);
    expect(io.revoke).not.toHaveBeenCalledWith(first);
    pool.dispose();
    expect(io.revoke).toHaveBeenCalledTimes(65);
  });

  it('超过字节预算时释放未使用图片，单张超限不生成地址', async () => {
    const { pool, io } = setup(
      async (url) => new Blob([new Uint8Array(Number(url)).fill(Number(url) % 255)]),
    );
    await pool.load(String(5 * 1024 * 1024));
    await pool.load(String(4 * 1024 * 1024));
    expect(pool.trim(new Set())).toEqual(['blob:1']);
    expect(await pool.load(String(9 * 1024 * 1024))).toBeNull();
    expect(io.create).toHaveBeenCalledTimes(2);
    pool.dispose();
  });

  it('释放期间返回的图不再生成地址，读取失败可再次尝试', async () => {
    let finish: (blob: Blob) => void = () => {};
    const result = new Promise<Blob>((resolve) => {
      finish = resolve;
    });
    const { pool, io } = setup(() => result);
    const reading = pool.load('pending');
    pool.dispose();
    finish(new Blob(['图']));
    expect(await reading).toBeNull();
    expect(io.create).not.toHaveBeenCalled();
    const read = vi
      .fn<QueueImageIO['read']>()
      .mockRejectedValueOnce(new Error('断开'))
      .mockResolvedValue(new Blob(['图']));
    const another = setup(read);
    expect(await another.pool.load('a')).toBeNull();
    expect(await another.pool.load('a')).toBe('blob:1');
    another.pool.dispose();
  });
});
