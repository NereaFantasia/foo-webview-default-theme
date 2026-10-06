import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  createQueueActions,
  queueUndoAtom,
} from '../../../../../src/shell/right-card/queue/queueActions.ts';
import {
  queueViewAtom,
  startQueueState,
} from '../../../../../src/shell/right-card/queue/queueState.ts';
import { installFakeQueue, queueTracks } from '../../../../fixtures/fakeQueue.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

async function setup(...titles: string[]) {
  const host = installFakeHost();
  const tracks = queueTracks(...titles);
  const queue = installFakeQueue(host, tracks);
  const store = createStore();
  const state = startQueueState(store, host.fb);
  await state.ready;
  const actions = createQueueActions(store, state, host.fb);
  const keyOf = (title: string) =>
    store.get(queueViewAtom).entries.find((entry) => entry.track.title === title)?.key ?? '';
  return { host, queue, store, state, actions, keyOf };
}

describe('createQueueActions', () => {
  it('立即播放：排在它前面的跳过，它被取走，后面的留着', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    expect(await actions.playNow(keyOf('c'))).toBe(true);
    expect(queue.titles()).toEqual(['d']);
  });

  it('移到队首、移除、只留这一首', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c');
    await actions.moveToTop(keyOf('c'));
    expect(queue.titles()).toEqual(['c', 'a', 'b']);
    await actions.remove([keyOf('a')]);
    expect(queue.titles()).toEqual(['c', 'b']);
    await actions.keepOnly(keyOf('b'));
    expect(queue.titles()).toEqual(['b']);
  });

  it('拖动：选中的几首按队列里的先后挪到落点前面，挪到队尾', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    await actions.move([keyOf('d'), keyOf('b')], keyOf('a'));
    expect(queue.titles()).toEqual(['b', 'd', 'a', 'c']);
    await actions.move([keyOf('b')], null);
    expect(queue.titles()).toEqual(['d', 'a', 'c', 'b']);
  });

  it('Alt+↑ / Alt+↓：挨着的一起走，到边上的不动', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    await actions.shift([keyOf('b'), keyOf('c')], -1);
    expect(queue.titles()).toEqual(['b', 'c', 'a', 'd']);
    await actions.shift([keyOf('b'), keyOf('c')], -1);
    expect(queue.titles()).toEqual(['b', 'c', 'a', 'd']);
    await actions.shift([keyOf('c')], 1);
    expect(queue.titles()).toEqual(['b', 'a', 'c', 'd']);
  });

  it('清空能撤销：整份按原来的顺序补回，记下清了几首；重做再清空', async () => {
    const { queue, store, actions } = await setup('a', 'b', 'c');
    await actions.clear();
    expect(queue.titles()).toEqual([]);
    expect(store.get(queueUndoAtom)).toEqual({ canUndo: true, canRedo: false, cleared: 3 });
    expect(await actions.undo()).toBe(true);
    expect(queue.titles()).toEqual(['a', 'b', 'c']);
    expect(store.get(queueUndoAtom)).toEqual({ canUndo: false, canRedo: true, cleared: null });
    expect(await actions.redo()).toBe(true);
    expect(queue.titles()).toEqual([]);
  });

  it('移除后期间又播掉了队首：撤销时播掉的不放回，其余回到原位', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    await actions.remove([keyOf('c')]);
    queue.advance();
    expect(await actions.undo()).toBe(true);
    expect(queue.titles()).toEqual(['b', 'c', 'd']);
  });

  it('撤销前已播放队首：反复重做与撤销都不再放回它', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    await actions.remove([keyOf('c')]);
    queue.advance();
    expect(await actions.undo()).toBe(true);
    expect(queue.titles()).toEqual(['b', 'c', 'd']);
    expect(await actions.redo()).toBe(true);
    expect(queue.titles()).toEqual(['b', 'd']);
    expect(await actions.undo()).toBe(true);
    expect(queue.titles()).toEqual(['b', 'c', 'd']);
  });

  it('撤销后才播放队首：重做再撤销也不放回它', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    await actions.remove([keyOf('c')]);
    await actions.undo();
    queue.advance();
    expect(await actions.redo()).toBe(true);
    expect(queue.titles()).toEqual(['b', 'd']);
    expect(await actions.undo()).toBe(true);
    expect(queue.titles()).toEqual(['b', 'c', 'd']);
  });

  it('移到队首后已播放：撤销与重做都只调整剩余曲目', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    await actions.moveToTop(keyOf('d'));
    queue.advance();
    expect(await actions.undo()).toBe(true);
    expect(queue.titles()).toEqual(['a', 'b', 'c']);
    expect(await actions.redo()).toBe(true);
    expect(queue.titles()).toEqual(['a', 'b', 'c']);
  });

  it.each(['remove', 'moveToTop', 'playNow'] as const)(
    '换曲后宿主仍报旧队首：%s 不按显示下标修改，通知到达后可重试',
    async (command) => {
      const { host, queue, state, actions, keyOf } = await setup('a', 'b', 'c');
      const first = queue.items[0]?.track;
      if (!first) throw new Error('缺曲目');
      host.emit('playback:trackChanged', first);
      const key = keyOf('c');
      const run = () => (command === 'remove' ? actions.remove([key]) : actions[command](key));
      expect(await run()).toBe(false);
      expect(queue.titles()).toEqual(['a', 'b', 'c']);
      expect(host.callsTo(`queue.${command}`)).toEqual([]);
      queue.advance();
      await state.refresh();
      expect(await run()).toBe(true);
      expect(queue.titles()).toEqual(
        command === 'remove' ? ['b'] : command === 'moveToTop' ? ['c', 'b'] : [],
      );
    },
  );

  it('调顺序能撤销', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c');
    await actions.move([keyOf('c')], keyOf('a'));
    await actions.undo();
    expect(queue.titles()).toEqual(['a', 'b', 'c']);
  });

  it('队列在别处被改过：这一步作废，撤销不动队列，也不当失败报', async () => {
    const { queue, store, actions, keyOf, state } = await setup('a', 'b', 'c');
    await actions.remove([keyOf('b')]);
    queue.set(queueTracks('x', 'y'));
    await state.refresh();
    expect(await actions.undo()).toBe(true);
    expect(queue.titles()).toEqual(['x', 'y']);
    expect(store.get(queueUndoAtom).canUndo).toBe(false);
  });

  it('找不到的行（已经播掉）不算：移除答 false、不动队列', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b');
    const gone = keyOf('a');
    queue.advance();
    expect(await actions.remove([gone])).toBe(false);
    expect(queue.titles()).toEqual(['b']);
  });

  it('两条命令同时发出：一条跑完再跑下一条，后一条按跑完之后的队列对下标', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c');
    const first = actions.remove([keyOf('a')]);
    const second = actions.remove([keyOf('c')]);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(queue.titles()).toEqual(['b']);
  });

  it('选中里含着落点那一首（多选里有队首时移到队首）：落到它后面第一首不挪的前面', async () => {
    const { queue, actions, keyOf } = await setup('a', 'b', 'c', 'd');
    await actions.move([keyOf('a'), keyOf('c')], keyOf('a'));
    expect(queue.titles()).toEqual(['a', 'c', 'b', 'd']);
  });
});
