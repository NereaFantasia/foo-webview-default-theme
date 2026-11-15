import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  entriesOf,
  queueViewAtom,
  startQueueState,
} from '../../../../src/playback/queue/queueState.ts';
import { installFakeQueue, queueTracks } from '../../../fixtures/fakeQueue.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

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
  it('先订阅再初读，队列变了整份重读，长度为 0 不必读', async () => {
    const host = installFakeHost();
    const queue = installFakeQueue(host, queueTracks('a', 'b'));
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    expect(store.get(queueViewAtom).status).toBe('ready');
    expect(titles(store)).toEqual(['a', 'b']);
    queue.set(queueTracks('c'));
    host.emit('playback:queueChanged', { origin: 'user_added', count: 1, contentVersion: '1' });
    await settle();
    expect(titles(store)).toEqual(['c']);
    const reads = host.callsTo('queue.get').length;
    host.emit('playback:queueChanged', { origin: 'user_removed', count: 0, contentVersion: '1' });
    expect(titles(store)).toEqual([]);
    expect(host.callsTo('queue.get')).toHaveLength(reads);
    service.dispose();
  });

  it('换曲事件里的新曲目就是队首：先去掉它，取走的通知到之前读回的队首照样去掉', async () => {
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
    // 宿主还没取走它：这次读回的队首仍是 a
    expect(await service.refresh()).toBeNull();
    expect(titles(store)).toEqual(['b']);
    service.dispose();
  });

  it('「下一首」起播：读回的队首先去掉，打开期间重读也不放回，换曲与取走之后仍不出现', async () => {
    const host = installFakeHost();
    const tracks = queueTracks('a', 'b');
    const queue = installFakeQueue(host, tracks);
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    const [first, second] = tracks;
    if (!first || !second) throw new Error('缺曲目');
    host.emit('playback:starting', { command: 'next', paused: false });
    await settle();
    expect(titles(store)).toEqual(['b']);
    // 曲目还在打开：这时重读，宿主队列里还有队首，视图仍不出现它
    host.emit('playback:queueChanged', { origin: 'user_added', count: 2, contentVersion: '1' });
    await settle();
    expect(titles(store)).toEqual(['b']);
    host.emit('playback:trackChanged', first);
    expect(titles(store)).toEqual(['b']);
    queue.set([second]);
    host.emit('playback:queueChanged', {
      origin: 'playback_advance',
      count: 1,
      contentVersion: '2',
    });
    await settle();
    expect(titles(store)).toEqual(['b']);
    service.dispose();
  });

  it('空队列点选起播：宿主先把目标排进队列再起播，这一首不在队列里出现', async () => {
    const host = installFakeHost();
    const [b] = queueTracks('b');
    if (!b) throw new Error('缺曲目');
    const queue = installFakeQueue(host, [], [b]);
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    // playlist.playTrack：先停止，再把目标排进队列（user_added），然后发出 starting(play)
    queue.set([b]);
    host.emit('playback:queueChanged', { origin: 'user_added', count: 1, contentVersion: '1' });
    host.emit('playback:starting', { command: 'play', paused: false });
    await settle();
    expect(titles(store)).toEqual([]);
    host.emit('playback:trackChanged', b);
    queue.set([]);
    host.emit('playback:queueChanged', {
      origin: 'playback_advance',
      count: 0,
      contentVersion: '2',
    });
    await settle();
    expect(titles(store)).toEqual([]);
    service.dispose();
  });

  it('队列非空点选起播：起播事件先于读回到达时，去掉的是新插入的目标，不是原来的队首', async () => {
    const host = installFakeHost();
    const [a, b, c] = queueTracks('a', 'b', 'c');
    if (!a || !b || !c) throw new Error('缺曲目');
    const queue = installFakeQueue(host, [a, c], [b]);
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    // 点选 b：插到队首，起播事件到达时视图仍是 [a, c]
    queue.set([b, a, c]);
    host.emit('playback:queueChanged', { origin: 'user_added', count: 3, contentVersion: '1' });
    host.emit('playback:starting', { command: 'next', paused: false });
    expect(titles(store)).toEqual(['a', 'c']);
    await settle();
    expect(titles(store)).toEqual(['a', 'c']);
    host.emit('playback:trackChanged', b);
    expect(titles(store)).toEqual(['a', 'c']);
    queue.set([a, c]);
    host.emit('playback:queueChanged', {
      origin: 'playback_advance',
      count: 2,
      contentVersion: '2',
    });
    await settle();
    expect(titles(store)).toEqual(['a', 'c']);
    service.dispose();
  });

  it('换到的不是正在打开的那一首（被跳过）：恢复显示，以读回的队列为准', async () => {
    const host = installFakeHost();
    const [a, b, other] = queueTracks('a', 'b', 'other');
    if (!a || !b || !other) throw new Error('缺曲目');
    installFakeQueue(host, [a, b]);
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    host.emit('playback:starting', { command: 'next', paused: false });
    await settle();
    expect(titles(store)).toEqual(['b']);
    host.emit('playback:trackChanged', other);
    await settle();
    expect(titles(store)).toEqual(['a', 'b']);
    service.dispose();
  });

  it('上一首起播不去掉队首。已经在打开一首时，后来的起播事件不再处理', async () => {
    const host = installFakeHost();
    installFakeQueue(host, queueTracks('a', 'b', 'c'));
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    host.emit('playback:starting', { command: 'previous', paused: false });
    await settle();
    expect(titles(store)).toEqual(['a', 'b', 'c']);
    host.emit('playback:starting', { command: 'next', paused: false });
    await settle();
    host.emit('playback:starting', { command: 'next', paused: false });
    await settle();
    expect(titles(store)).toEqual(['b', 'c']);
    service.dispose();
  });

  it('换曲途中的过渡停止不算，真正停止之后再起播，照常去掉队首', async () => {
    const host = installFakeHost();
    const [a, b, c] = queueTracks('a', 'b', 'c');
    if (!a || !b || !c) throw new Error('缺曲目');
    const queue = installFakeQueue(host, [a, b, c]);
    const store = createStore();
    const service = startQueueState(store, host.fb);
    await service.ready;
    const popped = async () => {
      queue.set([b, c]);
      host.emit('playback:queueChanged', {
        origin: 'playback_advance',
        count: 2,
        contentVersion: '2',
      });
      await settle();
    };
    host.emit('playback:starting', { command: 'next', paused: false });
    await settle();
    expect(titles(store)).toEqual(['b', 'c']);
    // 过渡停止：a 还在打开，后来的起播事件不再处理
    host.emit('playback:stopped', { reason: 'starting_another' });
    await popped();
    host.emit('playback:starting', { command: 'next', paused: false });
    await settle();
    expect(titles(store)).toEqual(['b', 'c']);
    // 真正停止：之后的起播事件重新认定队首
    host.emit('playback:stopped', { reason: 'user' });
    host.emit('playback:starting', { command: 'next', paused: false });
    await settle();
    expect(titles(store)).toEqual(['c']);
    service.dispose();
  });

  it('几次读同时在途：旧应答不写进原子，也不给命令使用', async () => {
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
    held.respond(0, { success: true, items: [], count: 0, contentVersion: '1' });
    expect(await older).toBeNull();
    expect(titles(store)).toEqual(['b']);
    service.dispose();
  });

  it('初读失败：状态记为失败', async () => {
    const host = installFakeHost({ answers: { queue: { get: hostFailure('INTERNAL_ERROR') } } });
    const store = createStore();
    await startQueueState(store, host.fb).ready;
    expect(store.get(queueViewAtom).status).toBe('failed');
  });
});
