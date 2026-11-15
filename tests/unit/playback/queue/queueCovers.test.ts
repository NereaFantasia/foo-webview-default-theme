import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  queueCoverKey,
  queueCoverSize,
  queueCoverUrlsAtom,
  startQueueCovers,
} from '../../../../src/playback/queue/queueCovers.ts';
import type { QueueImageIO } from '../../../../src/playback/queue/queueArtworkPool.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';
import { hostArtwork } from '../../../fixtures/trackArtwork.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** `unique` 为真时每张图的字节都不同，对象地址不会因内容相同而合并，才看得出是不是同一次取图的结果 */
function setup(unique = false) {
  const host = installFakeHost();
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: `fb2k://artwork/${String(params['path'])}`,
  }));
  let number = 0;
  let reads = 0;
  const io: QueueImageIO = {
    read: vi.fn(async () => new Blob([unique ? String(++reads) : '同图'])),
    create: vi.fn(() => `blob:${++number}`),
    revoke: vi.fn(),
  };
  const store = createStore();
  const service = startQueueCovers(store, hostArtwork(store, host.fb), io);
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

describe('同专辑共用', () => {
  const asked = (host: UnitHost) =>
    host.callsTo('artwork.getFb2kUrlByPath').map((call) => call['path']);
  const found = (path: string) => ({
    success: true as const,
    available: true,
    type: 'front' as const,
    path,
    dataUrl: `fb2k://artwork/${path}`,
  });

  it('同专辑同档尺寸只向宿主要一次，后来的曲目直接共用；换档、换专辑各取各的', async () => {
    const { host, store, service } = setup(true);
    const releases = ['a1', 'a2', 'a3'].map((path) => service.watch(path, 64, 'A'));
    await settle();
    expect(asked(host)).toEqual(['a1']);
    const key = (path: string, size = 64) => queueCoverKey(path, size);
    for (const path of ['a1', 'a2', 'a3'])
      expect(store.get(queueCoverUrlsAtom).get(key(path))).toBe('blob:1');
    // 已有结论：后来的同专辑曲目不再发请求
    releases.push(service.watch('a4', 64, 'A'));
    await settle();
    expect(asked(host)).toEqual(['a1']);
    expect(store.get(queueCoverUrlsAtom).get(key('a4'))).toBe('blob:1');
    releases.push(service.watch('a5', 128, 'A'), service.watch('b1', 64, 'B'));
    await settle();
    expect(asked(host)).toEqual(['a1', 'a5', 'b1']);
    releases.forEach((release) => release());
    service.dispose();
  });

  it('同专辑的别的曲目等代表曲目的结论，不占三路取图的名额', async () => {
    const { host, service } = setup(true);
    const held = host.hold('artwork.getFb2kUrlByPath');
    const releases = [
      service.watch('a1', 64, 'A'),
      service.watch('a2', 64, 'A'),
      service.watch('a3', 64, 'A'),
      service.watch('b1', 64, 'B'),
      service.watch('c1', 64, 'C'),
    ];
    await settle();
    expect(held.pending.map((call) => call['path'])).toEqual(['a1', 'b1', 'c1']);
    held.release();
    await settle();
    expect(asked(host)).toEqual(['a1', 'b1', 'c1']);
    releases.forEach((release) => release());
    service.dispose();
  });

  it('代表曲目没有封面：同专辑各首退回各取各的，后来的也不再等', async () => {
    const { host, store, service } = setup(true);
    host.answer('artwork.getFb2kUrlByPath', (params) => {
      const path = String(params['path']);
      return path === 'x1'
        ? { success: true, available: false, type: 'front', path, dataUrl: '' }
        : found(path);
    });
    const releases = ['x1', 'x2', 'x3'].map((path) => service.watch(path, 64, 'X'));
    await settle();
    expect(asked(host)).toEqual(['x1', 'x2', 'x3']);
    const urls = store.get(queueCoverUrlsAtom);
    expect(urls.has(queueCoverKey('x1', 64))).toBe(true);
    expect(urls.get(queueCoverKey('x1', 64))).toBeNull();
    expect(urls.get(queueCoverKey('x2', 64))).toBe('blob:1');
    expect(urls.get(queueCoverKey('x3', 64))).toBe('blob:2');
    releases.push(service.watch('x4', 64, 'X'));
    await settle();
    expect(asked(host)).toEqual(['x1', 'x2', 'x3', 'x4']);
    releases.forEach((release) => release());
    service.dispose();
  });

  it('瞬时失败不记成专辑的结论：同专辑下一首接着取，取到后别的曲目共用', async () => {
    const { host, store, service } = setup(true);
    const held = host.hold('artwork.getFb2kUrlByPath');
    const first = service.watch('a1', 64, 'A');
    service.watch('a2', 64, 'A');
    await settle();
    expect(held.pending.map((call) => call['path'])).toEqual(['a1']);
    held.respond(0, { success: false, error: '暂时失败', code: 'OPERATION_FAILED' });
    await settle();
    expect(held.pending.map((call) => call['path'])).toEqual(['a2']);
    held.respond(0, found('a2'));
    await settle();
    const urls = store.get(queueCoverUrlsAtom);
    expect(urls.has(queueCoverKey('a1', 64))).toBe(false);
    expect(urls.get(queueCoverKey('a2', 64))).toBe('blob:1');
    // 离屏再进入的 a1 直接共用 a2 取到的图
    first();
    service.watch('a1', 64, 'A');
    await settle();
    expect(asked(host)).toEqual(['a1', 'a2']);
    expect(store.get(queueCoverUrlsAtom).get(queueCoverKey('a1', 64))).toBe('blob:1');
    service.dispose();
  });

  it('共用的图被缓存回收后，不再把已回收的地址发给后来的曲目', async () => {
    const { host, io, store, service } = setup(true);
    for (let at = 0; at < 70; at++) {
      const release = service.watch(`p${at}`, 64, `A${at}`);
      await settle();
      release();
    }
    expect(io.revoke).toHaveBeenCalledWith('blob:1');
    service.watch('again', 64, 'A0');
    await settle();
    expect(asked(host).at(-1)).toBe('again');
    expect(store.get(queueCoverUrlsAtom).get(queueCoverKey('again', 64))).not.toBe('blob:1');
    service.dispose();
  });
});
