import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  entriesOf,
  queueViewAtom,
  startQueueState,
} from '../../../../../src/shell/right-card/queue/queueState.ts';
import { installFakeQueue, queueTracks } from '../../../../fixtures/fakeQueue.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const titles = (store: ReturnType<typeof createStore>) =>
  store.get(queueViewAtom).entries.map((entry) => entry.track.title);

describe('entriesOf', () => {
  it('同一首出现几次各编一个身份，带不带列表位置分开记', () => {
    const [a, b] = queueTracks('a', 'b');
    if (!a || !b) throw new Error('缺曲目');
    const entries = entriesOf([
      { ...a, playlist: null, playlistItem: null },
      { ...b, playlist: 2, playlistItem: 7 },
      { ...a, playlist: null, playlistItem: null },
    ]);
    expect(entries.map((entry) => entry.key)).toEqual([
      `${a.handle}#0`,
      `${b.handle}#0`,
      `${a.handle}#1`,
    ]);
    expect(entries[1]?.spot).toEqual({ playlist: 2, row: 7 });
    expect(entries[0]?.spot).toBeNull();
  });
});

describe('startQueueState', () => {
  it('先订阅再初读；队列变了整份重读，长度为 0 不必读', async () => {
    const host = installFakeHost();
    const queue = installFakeQueue(host, queueTracks('a', 'b'));
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    expect(store.get(queueViewAtom).status).toBe('ready');
    expect(titles(store)).toEqual(['a', 'b']);
    queue.set(queueTracks('c'));
    host.emit('playback:queueChanged', { origin: 'user_added', count: 1 });
    await settle();
    expect(titles(store)).toEqual(['c']);
    const reads = host.callsTo('queue.get').length;
    host.emit('playback:queueChanged', { origin: 'user_removed', count: 0 });
    expect(titles(store)).toEqual([]);
    expect(host.callsTo('queue.get')).toHaveLength(reads);
    service.dispose();
  });

  it('换曲事件里的新曲目就是队首：先摘掉；取走的通知到之前读回的队首照样摘', async () => {
    const host = installFakeHost();
    const tracks = queueTracks('a', 'b');
    installFakeQueue(host, tracks);
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    const [first] = tracks;
    if (!first) throw new Error('缺曲目');
    host.emit('playback:trackChanged', first);
    expect(titles(store)).toEqual(['b']);
    // 宿主还没取走它：这次读回的队首仍是 a。
    expect(await service.refresh()).toBeNull();
    expect(titles(store)).toEqual(['b']);
    service.dispose();
  });

  it('几次读同时在路上：旧应答不写进原子，也不给命令使用', async () => {
    const host = installFakeHost();
    const queue = installFakeQueue(host, queueTracks('a'));
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    const held = host.hold('queue.get');
    const older = service.refresh();
    queue.set(queueTracks('b'));
    const newer = service.refresh();
    held.respond(1);
    await newer;
    held.respond(0, { success: true, items: [], count: 0 });
    expect(await older).toBeNull();
    expect(titles(store)).toEqual(['b']);
    service.dispose();
  });

  it('初读失败：状态写失败', async () => {
    const host = installFakeHost({ answers: { queue: { get: hostFailure('INTERNAL_ERROR') } } });
    const store = createStore();
    await startQueueState(store, host.fb).ready;
    expect(store.get(queueViewAtom).status).toBe('failed');
  });
});
