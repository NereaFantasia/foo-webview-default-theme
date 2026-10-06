import { describe, expect, it } from 'vitest';
import { CoverGate, type CoverOutcome } from '../../../src/covers/coverGate.ts';
import { createCoverLoad } from '../../../src/covers/coverLoad.ts';

/** 一块图块的记账，接一份假的封面服务：名额给不给由测试定，排队的记下来由测试叫。 */
function setup(granted = true) {
  const reports: CoverOutcome[] = [];
  const queue = new Set<() => void>();
  const state = { granted, acquires: 0, redraws: 0 };
  const load = createCoverLoad(
    {
      acquire: () => {
        state.acquires += 1;
        return state.granted;
      },
      settle: (outcome) => reports.push(outcome),
      wait: (retry) => {
        queue.add(retry);
        return () => queue.delete(retry);
      },
    },
    () => (state.redraws += 1),
  );
  load.attach();
  /** 空出名额：按排队的先后叫一遍。 */
  const free = () => {
    state.granted = true;
    for (const retry of [...queue]) retry();
  };
  return { load, reports, queue, state, free };
}

const microtask = () => Promise.resolve();

describe('createCoverLoad', () => {
  it('拿到名额才把地址交给 <img>，并叫一次重画', () => {
    const { load, state } = setup();
    expect(load.src()).toBe('');
    load.show('fb2k://a');
    expect(load.src()).toBe('fb2k://a');
    expect(state.acquires).toBe(1);
    expect(state.redraws).toBe(1);
  });

  it('每次借用恰好报一次结局，之后的事件不再报', () => {
    const { load, reports, state } = setup();
    load.show('fb2k://a');
    load.finish('load');
    load.finish('error');
    load.show('fb2k://b');
    load.finish('error');
    load.finish('load');
    expect(reports).toEqual(['load', 'error']);
    expect(state.acquires).toBe(2);
  });

  it('同一个地址再给一次什么也不做：加载中与加载完都不另要名额、不报', () => {
    const { load, reports, state } = setup();
    load.show('fb2k://a');
    load.show('fb2k://a');
    load.finish('load');
    load.show('fb2k://a');
    expect(state.acquires).toBe(1);
    expect(reports).toEqual(['load']);
    expect(state.redraws).toBe(1);
  });

  it('加载中换地址不另借、不报放弃，换过之后的结局照常报', () => {
    const { load, reports, state } = setup();
    load.show('fb2k://256');
    load.show('fb2k://512');
    expect(load.src()).toBe('fb2k://512');
    expect(reports).toEqual([]);
    expect(state.acquires).toBe(1);
    load.finish('load');
    expect(reports).toEqual(['load']);
  });

  it('加载中地址清空（判了缺图、清单换了）报放弃，改画占位', () => {
    const { load, reports } = setup();
    load.show('fb2k://a');
    load.show('');
    expect(load.src()).toBe('');
    expect(reports).toEqual(['abandon']);
  });

  it('加载完了再清空地址不报', () => {
    const { load, reports } = setup();
    load.show('fb2k://b');
    load.finish('load');
    load.show('');
    expect(reports).toEqual(['load']);
  });

  it('拿不到名额：先画占位、排队，空出名额时换上', () => {
    const { load, queue, free, state } = setup(false);
    load.show('fb2k://a');
    expect(load.src()).toBe('');
    expect(queue.size).toBe(1);
    free();
    expect(load.src()).toBe('fb2k://a');
    expect(queue.size).toBe(0);
    expect(state.acquires).toBe(2);
  });

  it('升档拿不到名额：手上加载完的旧图照画，拿到了才换新地址', () => {
    const { load, free, state } = setup();
    load.show('fb2k://256');
    load.finish('load');
    state.granted = false;
    load.show('fb2k://512', 'fb2k://128');
    expect(load.src()).toBe('fb2k://256');
    free();
    expect(load.src()).toBe('fb2k://512');
  });

  it('排队中被叫到仍拿不到：接着排', () => {
    const { load, queue, state } = setup(false);
    load.show('fb2k://a');
    for (const retry of [...queue]) retry();
    expect(queue.size).toBe(1);
    expect(load.src()).toBe('');
    expect(state.acquires).toBe(2);
  });

  it('排队中换了地址：撤出旧的那一队，为新地址重新要、重新排', () => {
    const { load, queue, state } = setup(false);
    load.show('fb2k://a');
    const first = [...queue][0];
    load.show('fb2k://b');
    expect(queue.size).toBe(1);
    expect([...queue][0]).not.toBe(first);
    expect(state.acquires).toBe(2);
  });

  it('排队中地址清空：撤出排队', () => {
    const { load, queue } = setup(false);
    load.show('fb2k://a');
    load.show('');
    expect(queue.size).toBe(0);
  });

  it('拿不到名额、手上没有图：先垫着加载过的旧一档（不占名额、不报），拿到了换上新地址', () => {
    const { load, reports, free } = setup(false);
    load.show('fb2k://512', 'fb2k://256');
    expect(load.src()).toBe('fb2k://256');
    load.finish('load');
    expect(reports).toEqual([]);
    free();
    expect(load.src()).toBe('fb2k://512');
    load.finish('load');
    expect(reports).toEqual(['load']);
  });

  it('加载中卸掉，过一个微任务报放弃', async () => {
    const { load, reports } = setup();
    load.show('fb2k://a');
    load.detach();
    expect(reports).toEqual([]);
    await microtask();
    expect(reports).toEqual(['abandon']);
  });

  it('卸掉又马上挂回（开发时的二次 effect）不报放弃', async () => {
    const loading = setup();
    loading.load.show('fb2k://a');
    loading.load.detach();
    loading.load.attach();
    await microtask();
    expect(loading.reports).toEqual([]);
  });

  it('垫着旧一档时拿到名额、还没重渲染，旧图的 load 才到：不算新地址的结局', () => {
    const { load, reports, free } = setup(false);
    load.show('fb2k://512', 'fb2k://256');
    free();
    expect(load.src()).toBe('fb2k://512');
    load.finish('load', 'fb2k://256');
    expect(reports).toEqual([]);
    load.finish('error', 'fb2k://512');
    expect(reports).toEqual(['error']);
  });

  it('手上画着加载完的旧图时要换回它（升档出错退回）：不借名额，卸掉时也没有借用要还', async () => {
    const { load, queue, reports, state } = setup();
    load.show('fb2k://256');
    load.finish('load');
    state.granted = false;
    load.show('fb2k://512');
    state.granted = true;
    load.show('fb2k://256');
    expect(load.src()).toBe('fb2k://256');
    expect(queue.size).toBe(0);
    load.detach();
    await microtask();
    expect(reports).toEqual(['load']);
  });

  it('排队中卸掉：过一个微任务撤出排队，之后空出名额也不再要', async () => {
    const { load, queue, free, state } = setup(false);
    load.show('fb2k://a');
    load.detach();
    await microtask();
    expect(queue.size).toBe(0);
    free();
    expect(state.acquires).toBe(1);
  });

  it('加载完了再卸掉不报', async () => {
    const { load, reports } = setup();
    load.show('fb2k://a');
    load.finish('load');
    load.detach();
    await microtask();
    expect(reports).toEqual(['load']);
  });

  it('出错的地址改画占位；地址换过再换回来照常画，也照常要名额', () => {
    const { load, state } = setup();
    load.show('fb2k://a');
    load.finish('error');
    expect(load.src()).toBe('');
    expect(state.redraws).toBe(2);
    load.show('');
    load.show('fb2k://a');
    expect(load.src()).toBe('fb2k://a');
    expect(state.acquires).toBe(2);
  });
});

describe('名额总能还回去', () => {
  function gated() {
    const gate = new CoverGate({ limit: 1, retryDelays: [5000], onCooled: () => {} });
    const tileOf = (key: string) => {
      const load = createCoverLoad(
        {
          acquire: () => gate.acquire(key),
          settle: (outcome) => gate.settle(key, outcome),
          wait: (retry) => gate.wait(retry),
        },
        () => {},
      );
      load.attach();
      return load;
    };
    return { gate, tileOf };
  }

  it('加载中滚出视口或所在的节折起来（卸掉），名额还回去，下一张拿得到', async () => {
    const { gate, tileOf } = gated();
    const a = tileOf('A');
    a.show('fb2k://a');
    expect(gate.acquire('B')).toBe(false);
    a.detach();
    await microtask();
    expect(gate.loading).toBe(0);
    expect(gate.acquire('B')).toBe(true);
  });

  it('加载出错也还名额', () => {
    const { gate, tileOf } = gated();
    const a = tileOf('A');
    a.show('fb2k://a');
    a.finish('error');
    expect(gate.loading).toBe(0);
  });

  it('加载中地址被清空也还名额', () => {
    const { gate, tileOf } = gated();
    const b = tileOf('B');
    b.show('fb2k://b');
    b.show('');
    expect(gate.loading).toBe(0);
  });

  it('同一张专辑的两块副本，一块加载中卸掉、另一块加载完：名额空出，再要时不看上限', async () => {
    const { gate, tileOf } = gated();
    const first = tileOf('A');
    const second = tileOf('A');
    first.show('fb2k://a');
    second.show('fb2k://a');
    first.detach();
    await microtask();
    second.finish('load');
    expect(gate.loading).toBe(0);
    expect(gate.acquire('B')).toBe(true);
    expect(gate.acquire('A')).toBe(true);
  });

  it('同一次提交里卸掉旧块、挂上新块（行换了）：新块加载完，名额空出', async () => {
    const { gate, tileOf } = gated();
    const old = tileOf('A');
    old.show('fb2k://a');
    old.detach();
    const moved = tileOf('A');
    moved.show('fb2k://a');
    await microtask();
    moved.finish('load');
    expect(gate.loading).toBe(0);
    expect(gate.acquire('B')).toBe(true);
  });
});
