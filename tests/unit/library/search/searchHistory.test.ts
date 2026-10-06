import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../../src/host/waitForHost.ts';
import { createConfigWriter } from '../../../../src/host/configWrite.ts';
import { DATA_GENERATION_PREFIX } from '../../../../src/kit/dataWrite.ts';
import {
  SEARCH_HISTORY_KEY,
  startSearchHistory,
} from '../../../../src/library/search/searchHistory.ts';
import { createMemoryDataWriter, occupyWriteLock } from '../../../fixtures/dataWriter.ts';
import { hostFailure, type ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

afterEach(() => vi.useRealTimers());

function setup(saved?: ConfigValue, available = true) {
  const host = installFakeHost({
    available,
    config: saved === undefined ? {} : { [SEARCH_HISTORY_KEY]: saved },
  });
  const store = createStore();
  const data = createMemoryDataWriter();
  const service = startSearchHistory(store, host.fb, createConfigWriter(host.fb, data.writer));
  onTestFinished(() => service.dispose());
  return { host, store, data, service, state: () => store.get(service.state) };
}

describe('搜索历史', () => {
  it('沿用旧键，验证外部存档，精确去重且最多十条', async () => {
    const { service, state } = setup(['A', 'A', '', ' a ', 7, false, 'B']);
    await service.ready;
    expect(state()).toEqual({ items: ['A', 'a', 'B'], failed: false });
    for (let i = 0; i < 12; i += 1) service.remember(`词 ${i}`);
    expect(state().items).toEqual(Array.from({ length: 10 }, (_, i) => `词 ${11 - i}`));
    service.remember(' 词 5 ');
    expect(state().items[0]).toBe('词 5');
    expect(state().items.filter((item) => item === '词 5')).toHaveLength(1);
    service.remember('   ');
    expect(state().items[0]).toBe('词 5');
  });

  it('删除一条和清空立即生效并持久化', async () => {
    const { host, service, state } = setup(['A', 'B']);
    await service.ready;
    service.remove('A');
    await vi.waitFor(() => expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual(['B']));
    expect(state().items).toEqual(['B']);
    service.clear();
    await vi.waitFor(() => expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual([]));
    expect(state().items).toEqual([]);
  });

  it('清空早于旧存档读回，旧值不复活', async () => {
    const { host, service, state } = setup(['A', 'B']);
    const held = host.hold('config.get');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.clear();
    held.respond(0, {
      success: true,
      key: SEARCH_HISTORY_KEY,
      found: true,
      value: ['A', 'B'],
    });
    await service.ready;
    await vi.waitFor(() => expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual([]));
    expect(state()).toEqual({ items: [], failed: false });
  });

  it('连续写入串行，只补写最后一份，不让晚到的旧写覆盖新词', async () => {
    const { host, service, state } = setup();
    await service.ready;
    const held = host.hold('config.set');
    service.remember('A');
    service.remember('B');
    service.remove('A');
    await vi.waitFor(() =>
      expect(held.pending).toEqual([{ key: SEARCH_HISTORY_KEY, value: ['A'] }]),
    );
    held.respond(0);
    await vi.waitFor(() =>
      expect(held.pending).toEqual([{ key: SEARCH_HISTORY_KEY, value: ['B'] }]),
    );
    held.respond(0);
    await vi.waitFor(() => expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual(['B']));
    expect(state()).toEqual({ items: ['B'], failed: false });
  });

  it('上一份写失败时仍补写期间的新修改，最新一份失败才等待重试', async () => {
    const { host, service, state } = setup();
    await service.ready;
    const held = host.hold('config.set');
    service.remember('A');
    service.remember('B');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await vi.waitFor(() => expect(held.pending[0]?.['value']).toEqual(['B', 'A']));
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await vi.waitFor(() => expect(state().failed).toBe(true));
    expect(state().items).toEqual(['B', 'A']);
    held.release();
    await service.retry();
    expect(state().failed).toBe(false);
    expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual(['B', 'A']);
  });

  it('写入刚完成、写锁尚未释放时到来的修改仍会落盘', async () => {
    const { host, store, service, state } = setup();
    await service.ready;
    let armed = false;
    const off = store.sub(service.state, () => {
      if (!armed) return;
      armed = false;
      queueMicrotask(() => service.remember('B'));
    });
    onTestFinished(off);
    service.remember('A');
    armed = true;
    await vi.waitFor(() => expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual(['B', 'A']));
    expect(state().items).toEqual(['B', 'A']);
  });

  it('未连宿主时修改留在内存，重连后新词在前，未删除的旧词保留', async () => {
    vi.useFakeTimers();
    const { host, service, state } = setup(['old'], false);
    service.remember('new');
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await service.ready;
    expect(state()).toEqual({ items: ['new'], failed: true });
    expect(host.callsTo('config.set')).toEqual([]);
    host.connect();
    await service.retry();
    expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual(['new', 'old']);
    expect(state().failed).toBe(false);
  });

  it('初读期间的增加和删除按次序应用到旧存档，不误删其余历史', async () => {
    const { host, service, state } = setup(['A', 'B', 'C']);
    const held = host.hold('config.get');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.remember('new');
    service.remove('B');
    service.remember('A');
    held.respond(0, {
      success: true,
      key: SEARCH_HISTORY_KEY,
      found: true,
      value: ['A', 'B', 'C'],
    });
    await service.ready;
    expect(state().items).toEqual(['A', 'new', 'C']);
    expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual(['A', 'new', 'C']);
  });

  it('初读失败时不拿未合并的内存历史覆盖存档，重试成功后再写', async () => {
    const { host, service, state } = setup(['old']);
    host.answer('config.get', hostFailure('OPERATION_FAILED'));
    service.remember('new');
    await service.ready;
    expect(state()).toEqual({ items: ['new'], failed: true });
    expect(host.callsTo('config.set')).toEqual([]);
    host.answer('config.get', {
      success: true,
      key: SEARCH_HISTORY_KEY,
      value: ['old'],
      found: true,
    });
    await service.retry();
    expect(state()).toEqual({ items: ['new', 'old'], failed: false });
    expect(host.config.get(SEARCH_HISTORY_KEY)).toEqual(['new', 'old']);
  });

  it('读取失败可以重试，释放后的晚到读取及修改均不落地', async () => {
    const { host, service, state } = setup(['A']);
    host.answer('config.get', hostFailure('OPERATION_FAILED'));
    await service.ready;
    expect(state().failed).toBe(true);
    const held = host.hold('config.get');
    const retry = service.retry();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.dispose();
    const before = state();
    held.respond(0, { success: true, key: SEARCH_HISTORY_KEY, value: ['A'], found: true });
    await retry;
    service.remember('B');
    expect(state()).toEqual(before);
  });

  it('保存经写入助手记代数；没有写入助手时按失败处理，不直接写宿主', async () => {
    const env = setup();
    await env.service.ready;
    env.service.remember('A');
    await vi.waitFor(() =>
      expect(env.data.values.get(`${DATA_GENERATION_PREFIX}config:${SEARCH_HISTORY_KEY}`)).toBe(
        '1',
      ),
    );
    expect(env.state()).toEqual({ items: ['A'], failed: false });

    const host = installFakeHost();
    const store = createStore();
    const bare = startSearchHistory(store, host.fb);
    onTestFinished(() => bare.dispose());
    await bare.ready;
    bare.remember('B');
    await vi.waitFor(() => expect(store.get(bare.state).failed).toBe(true));
    expect(store.get(bare.state).items).toEqual(['B']);
    expect(host.callsTo('config.set')).toEqual([]);
  });

  it('释放时取消仍在等锁的写入', async () => {
    const env = setup();
    await env.service.ready;
    const release = await occupyWriteLock(env.data.writer);
    env.service.remember('A');
    env.service.dispose();
    await release();
    // 写锁先来先得：后排的这次拿到锁时，没被取消的写入早已执行完。
    await env.data.writer.run(() => undefined);
    expect(env.data.values.size).toBe(0);
    expect(env.host.callsTo('config.set')).toEqual([]);
  });
});
