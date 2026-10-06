import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { queueCountAtom, startQueueCount } from '../../../src/playback/queueCount.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startQueueCount', () => {
  it('先订阅再初读：初读的长度写进原子，之后跟着 queueChanged 带的长度', async () => {
    const host = installFakeHost({
      answers: { queue: { getCount: { success: true, count: 3, hasItems: true } } },
    });
    const store = createStore();
    const service = startQueueCount(store, host.fb);
    await service.ready;
    expect(store.get(queueCountAtom)).toBe(3);
    host.emit('playback:queueChanged', { origin: 'playback_advance', count: 2 });
    expect(store.get(queueCountAtom)).toBe(2);
    service.dispose();
  });

  it('初读还没回来就来了一次事件：事件的长度为准，晚到的初读丢掉', async () => {
    const host = installFakeHost({
      answers: { queue: { getCount: { success: true, count: 5, hasItems: true } } },
    });
    const held = host.hold('queue.getCount');
    const store = createStore();
    const service = startQueueCount(store, host.fb);
    await settle();
    host.emit('playback:queueChanged', { origin: 'user_added', count: 1 });
    held.release();
    await service.ready;
    expect(store.get(queueCountAtom)).toBe(1);
    service.dispose();
  });

  it('读失败当 0', async () => {
    const failing = installFakeHost({
      answers: { queue: { getCount: hostFailure('INTERNAL_ERROR') } },
    });
    const store = createStore();
    await startQueueCount(store, failing.fb).ready;
    expect(store.get(queueCountAtom)).toBe(0);
  });

  it('释放之后不再跟事件', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startQueueCount(store, host.fb);
    await service.ready;
    service.dispose();
    host.emit('playback:queueChanged', { origin: 'user_added', count: 4 });
    expect(store.get(queueCountAtom)).toBe(0);
  });
});
