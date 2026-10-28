import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { startMusicStatus } from '../../../src/playback/musicStatus.ts';
import type { MusicStatus } from '../../../src/server/musicProtocol.ts';

const READY: MusicStatus = {
  platforms: ['wy'],
  ncm: 'loaded',
  lx: 'unconfigured',
  lxServer: null,
  lxHosted: false,
  account: null,
  unblock: false,
};

/** 每次 `status` 调用交出一个由测试决定何时答回的应答。 */
function setup(reconnect: () => Promise<void> = async () => {}) {
  const store = createStore();
  const replies: { resolve(value: MusicStatus): void; reject(error: Error): void }[] = [];
  const service = startMusicStatus(
    store,
    {
      status: () =>
        new Promise<MusicStatus>((resolve, reject) => {
          replies.push({ resolve, reject });
        }),
    },
    reconnect,
  );
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store, service, replies, flush };
}

describe('musicStatus', () => {
  it('第一次读还没答回时是 unknown，从没读到过就失败时是 failed', async () => {
    const { store, service, replies, flush } = setup();
    expect(store.get(service.state)).toEqual({ status: 'unknown' });
    service.refresh();
    replies[0]?.reject(new Error('本地后端尚未连接'));
    await flush();
    expect(store.get(service.state)).toEqual({ status: 'failed' });
  });

  it('读到过之后再失败保留上一次的值', async () => {
    const { store, service, replies, flush } = setup();
    service.refresh();
    replies[0]?.resolve(READY);
    await flush();
    service.refresh();
    replies[1]?.reject(new Error('超时'));
    await flush();
    expect(store.get(service.state)).toEqual({ status: 'ready', music: READY });
  });

  it('写操作答回的状态盖过在途的读', async () => {
    const { store, service, replies, flush } = setup();
    service.refresh();
    service.apply({ ...READY, unblock: true });
    replies[0]?.resolve(READY);
    await flush();
    expect(store.get(service.state)).toEqual({
      status: 'ready',
      music: { ...READY, unblock: true },
    });
  });

  it('重试先等重连，再重读；重连失败也照样重读', async () => {
    const order: string[] = [];
    const { service, replies } = setup(async () => {
      order.push('reconnect');
      throw new Error('引导失败');
    });
    await service.reconnect();
    order.push(`status ${replies.length}`);
    expect(order).toEqual(['reconnect', 'status 1']);
  });
});
