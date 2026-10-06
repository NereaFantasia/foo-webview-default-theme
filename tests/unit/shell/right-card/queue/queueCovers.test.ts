import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  queueCoverKey,
  queueCoverSize,
  queueCoverUrlsAtom,
  startQueueCovers,
} from '../../../../../src/shell/right-card/queue/queueCovers.ts';
import type { QueueImageIO } from '../../../../../src/shell/right-card/queue/queueArtworkPool.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup() {
  const host = installFakeHost();
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: `fb2k://artwork/${String(params['path'])}`,
  }));
  let number = 0;
  const io: QueueImageIO = {
    read: vi.fn(async () => new Blob(['同图'])),
    create: vi.fn(() => `blob:${++number}`),
    revoke: vi.fn(),
  };
  const store = createStore();
  const service = startQueueCovers(store, host.fb, io);
  return { host, io, store, service };
}

describe('可见队列封面', () => {
  it('限制缩略图与预览规格，高缩放也不超过 512 像素', () => {
    expect(queueCoverSize(false, 1)).toBe(64);
    expect(queueCoverSize(false, 4)).toBe(128);
    expect(queueCoverSize(true, 1)).toBe(384);
    expect(queueCoverSize(true, 4)).toBe(512);
    expect(queueCoverSize(true, NaN)).toBe(384);
  });

  it('同路径并发订阅只取一次，不同路径相同内容复用对象地址', async () => {
    const { host, io, store, service } = setup();
    const first = service.watch('a', 128);
    const second = service.watch('a', 128);
    const third = service.watch('b', 128);
    await settle();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toEqual([
      { path: 'a', type: 'front', maxSize: 128 },
      { path: 'b', type: 'front', maxSize: 128 },
    ]);
    expect(store.get(queueCoverUrlsAtom).get(queueCoverKey('a', 128))).toBe('blob:1');
    expect(store.get(queueCoverUrlsAtom).get(queueCoverKey('b', 128))).toBe('blob:1');
    expect(io.create).toHaveBeenCalledTimes(1);
    first();
    second();
    third();
    service.dispose();
    expect(io.revoke).toHaveBeenCalledTimes(1);
  });

  it('最多三路取图；离屏撤销还没发出的请求', async () => {
    const { host, service } = setup();
    const held = host.hold('artwork.getFb2kUrlByPath');
    const releases = ['a', 'b', 'c', 'd', 'e'].map((path) => service.watch(path, 64));
    await settle();
    expect(held.pending).toHaveLength(3);
    releases[3]();
    held.respond(0);
    await settle();
    expect(held.pending).toHaveLength(3);
    expect(held.pending.some((p) => p['path'] === 'e')).toBe(true);
    expect(host.callsTo('artwork.getFb2kUrlByPath').some((p) => p['path'] === 'd')).toBe(false);
    held.release();
    await settle();
    releases.forEach((release) => release());
    service.dispose();
  });

  it('临时失败重新进入可重试；释放后旧应答不写入缓存', async () => {
    const { host, store, service } = setup();
    const held = host.hold('artwork.getFb2kUrlByPath');
    const release = service.watch('a', 512);
    await settle();
    held.respond(0, { success: false, error: '暂时失败', code: 'OPERATION_FAILED' });
    await settle();
    expect(store.get(queueCoverUrlsAtom).has(queueCoverKey('a', 512))).toBe(false);
    release();
    service.watch('a', 512);
    await settle();
    expect(held.pending).toHaveLength(1);
    service.dispose();
    held.release();
    await settle();
    expect(store.get(queueCoverUrlsAtom).size).toBe(0);
  });
});
