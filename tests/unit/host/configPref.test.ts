import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  configSaveFailuresAtom,
  defineConfigPref,
  startConfigPrefs,
} from '../../../src/host/configPref.ts';
import { createConfigWriter } from '../../../src/host/configWrite.ts';
import { DATA_GENERATION_PREFIX } from '../../../src/kit/dataWrite.ts';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { createMemoryDataWriter } from '../../fixtures/dataWriter.ts';
import { installFakeHost, type UnitHostOptions } from '../../fixtures/unitHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

const FIRST_KEY = 'defaultTheme.sample.first';
const SECOND_KEY = 'defaultTheme.sample.second';

function setup(options: UnitHostOptions = {}) {
  const host = installFakeHost(options);
  const store = createStore();
  const first = defineConfigPref(FIRST_KEY, 'default', (value) =>
    typeof value === 'string' ? value : undefined,
  );
  const second = defineConfigPref(SECOND_KEY, false, (value) =>
    typeof value === 'boolean' ? value : undefined,
  );
  const data = createMemoryDataWriter();
  const writer = createConfigWriter(host.fb, data.writer);
  const prefs = startConfigPrefs(store, [first, second], host.fb, writer);
  onTestFinished(() => prefs.dispose());
  return {
    host,
    store,
    first,
    second,
    data,
    writer,
    prefs,
    state: (key = FIRST_KEY) => store.get(prefs.state).get(key),
  };
}

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('宿主偏好的持久化', () => {
  it('汇总失败通过原服务重试，释放后移除，其他 store 的失败不混进来', async () => {
    const env = setup();
    await env.prefs.ready;
    env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
    await env.prefs.set(env.first, 'chosen');
    const failures = env.store.get(configSaveFailuresAtom);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ key: FIRST_KEY, reason: 'write-failed' });
    expect(createStore().get(configSaveFailuresAtom)).toEqual([]);
    env.host.answer('config.set', (params) => {
      env.host.config.set(FIRST_KEY, String(params['value']));
      return { success: true, key: FIRST_KEY };
    });
    expect(await failures[0]?.retry()).toBe(true);
    expect(env.state()?.status).toBe('saved');
    expect(env.store.get(configSaveFailuresAtom)).toEqual([]);
    expect(env.host.config.get(FIRST_KEY)).toBe('chosen');
    env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
    await env.prefs.set(env.first, 'next');
    expect(env.store.get(configSaveFailuresAtom)).toHaveLength(1);
    env.prefs.dispose();
    expect(env.store.get(configSaveFailuresAtom)).toEqual([]);
    expect(await failures[0]?.retry()).toBe(false);
  });

  it('恢复存档不记为用户写入，修改后记录独立代数', async () => {
    const env = setup({ config: { [FIRST_KEY]: 'saved' } });
    await env.prefs.ready;
    expect(env.store.get(env.first.atom)).toBe('saved');
    expect(env.state()).toEqual({ status: 'idle' });
    expect(env.data.values.size).toBe(0);
    expect(await env.prefs.set(env.first, 'new')).toBe(true);
    expect(env.host.config.get(FIRST_KEY)).toBe('new');
    expect(env.state()).toEqual({ status: 'saved', generation: 1 });
    expect(await env.prefs.set(env.second, true)).toBe(true);
    expect(env.state(SECOND_KEY)).toEqual({ status: 'saved', generation: 2 });
    expect(env.data.values.get(`${DATA_GENERATION_PREFIX}config:${FIRST_KEY}`)).toBe('1');
    expect(env.data.values.get(`${DATA_GENERATION_PREFIX}config:${SECOND_KEY}`)).toBe('2');
  });

  it('宿主未到时立即更新内存，只补写同一项最后的选择', async () => {
    const env = setup({ available: false, config: { [FIRST_KEY]: 'saved' } });
    const first = env.prefs.set(env.first, 'first');
    const second = env.prefs.set(env.first, 'last');
    expect(env.store.get(env.first.atom)).toBe('last');
    expect(env.state()).toEqual({ status: 'pending' });
    env.host.connect();
    await env.prefs.ready;
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(env.host.config.get(FIRST_KEY)).toBe('last');
    expect(env.state()).toEqual({ status: 'saved', generation: 1 });
  });

  it('初读尚未返回时选择缺省值也要持久化，旧应答不能覆盖它', async () => {
    const host = installFakeHost({ config: { [FIRST_KEY]: 'old' } });
    const held = host.hold('config.get');
    const store = createStore();
    const pref = defineConfigPref(FIRST_KEY, 'default', (value) =>
      typeof value === 'string' ? value : undefined,
    );
    const data = createMemoryDataWriter();
    const prefs = startConfigPrefs(
      store,
      [pref],
      host.fb,
      createConfigWriter(host.fb, data.writer),
    );
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(await prefs.set(pref, 'default')).toBe(true);
    held.respond(0, { success: true, key: FIRST_KEY, found: true, value: 'old' });
    await prefs.ready;
    expect(store.get(pref.atom)).toBe('default');
    expect(host.config.get(FIRST_KEY)).toBe('default');
    expect(data.values.get(`${DATA_GENERATION_PREFIX}config:${FIRST_KEY}`)).toBe('1');
    prefs.dispose();
  });

  it('写入尚未兑现时相同值共用结果，成功后相同值不再写', async () => {
    const env = setup();
    await env.prefs.ready;
    const held = env.host.hold('config.set');
    const first = env.prefs.set(env.first, 'same');
    const second = env.prefs.set(env.first, 'same');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(env.state()).toEqual({ status: 'pending' });
    held.release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await env.prefs.set(env.first, 'same')).toBe(true);
    expect(env.state()).toEqual({ status: 'saved', generation: 1 });
  });

  it('失败按键保留当前值，可重试相同值，其他项的成功不清掉它', async () => {
    const env = setup();
    await env.prefs.ready;
    env.host.answer('config.set', (params) => {
      const key = String(params['key']);
      if (key === FIRST_KEY) return hostFailure('OPERATION_FAILED');
      env.host.config.set(SECOND_KEY, true);
      return { success: true, key };
    });
    expect(await env.prefs.set(env.first, 'new')).toBe(false);
    expect(env.store.get(env.first.atom)).toBe('new');
    expect(await env.prefs.set(env.second, true)).toBe(true);
    expect(env.state()).toEqual({ status: 'failed', reason: 'write-failed' });
    expect(env.state(SECOND_KEY)).toEqual({ status: 'saved', generation: 1 });
    env.host.answer('config.set', () => {
      env.host.config.set(FIRST_KEY, 'new');
      return { success: true, key: FIRST_KEY };
    });
    expect(await env.prefs.retry(FIRST_KEY)).toBe(true);
    expect(env.state()).toEqual({ status: 'saved', generation: 2 });
    expect(env.host.config.get(FIRST_KEY)).toBe('new');
    expect(await env.prefs.retry(SECOND_KEY)).toBe(false);
  });

  it('旧请求的失败不能覆盖后一项选择的保存状态', async () => {
    const env = setup();
    await env.prefs.ready;
    const entered = gate();
    const response = gate();
    env.host.answer('config.set', async (params) => {
      if (params['value'] === 'old') {
        entered.release();
        await response.promise;
        return hostFailure('OPERATION_FAILED');
      }
      env.host.config.set(FIRST_KEY, 'new');
      return { success: true, key: FIRST_KEY };
    });
    const old = env.prefs.set(env.first, 'old');
    await entered.promise;
    const next = env.prefs.set(env.first, 'new');
    response.release();
    expect(await old).toBe(false);
    expect(await next).toBe(true);
    expect(env.state()).toEqual({ status: 'saved', generation: 1 });
    expect(env.store.get(env.first.atom)).toBe('new');
    expect(env.host.config.get(FIRST_KEY)).toBe('new');
  });

  it('取消排队的写入，不取消其他服务已经持有的锁', async () => {
    const env = setup();
    await env.prefs.ready;
    const entered = gate();
    const finish = gate();
    const blocker = env.data.writer.run(async () => {
      entered.release();
      await finish.promise;
    });
    await entered.promise;
    const pending = env.prefs.set(env.first, 'cancelled');
    env.prefs.dispose();
    expect(await pending).toBe(false);
    expect(env.host.config.has(FIRST_KEY)).toBe(false);
    expect(env.data.values.size).toBe(0);
    finish.release();
    await blocker;
    expect(await env.writer.set(FIRST_KEY, 'another service')).toEqual({ success: true, value: 1 });
  });

  it('释放前已经持锁的请求仍完成宿主值与代数记录', async () => {
    const env = setup();
    await env.prefs.ready;
    const held = env.host.hold('config.set');
    const pending = env.prefs.set(env.first, 'saved');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.prefs.dispose();
    held.release();
    expect(await pending).toBe(true);
    expect(env.host.config.get(FIRST_KEY)).toBe('saved');
    expect(env.data.values.get(`${DATA_GENERATION_PREFIX}config:${FIRST_KEY}`)).toBe('1');
    expect(await env.prefs.set(env.first, 'late')).toBe(false);
    expect(env.store.get(env.first.atom)).toBe('saved');
  });

  it('未连接宿主就释放时，等待补写的结果也会结束', async () => {
    const env = setup({ available: false });
    const pending = env.prefs.set(env.first, 'pending');
    env.prefs.dispose();
    expect(await pending).toBe(false);
    await env.prefs.ready;
    expect(env.host.config.has(FIRST_KEY)).toBe(false);
  });

  it('连接超时明确失败，settled 不永久等待', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const env = setup({ available: false });
    const pending = env.prefs.set(env.first, 'pending');
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(await pending).toBe(false);
    await env.prefs.ready;
    await env.prefs.settled();
    expect(env.state()).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(env.host.config.has(FIRST_KEY)).toBe(false);
  });

  it('没有注入写入助手时不直接写 config，拒绝本服务之外的偏好', async () => {
    const env = setup();
    await env.prefs.ready;
    const other = defineConfigPref('defaultTheme.other', 'old', String);
    expect(await env.prefs.set(other, 'new')).toBe(false);
    expect(env.store.get(other.atom)).toBe('old');
    const noWriter = startConfigPrefs(env.store, [other], env.host.fb);
    await noWriter.ready;
    expect(await noWriter.set(other, 'new')).toBe(false);
    expect(env.store.get(noWriter.state).get(other.key)).toEqual({
      status: 'failed',
      reason: 'unavailable',
    });
    expect(env.host.config.has(other.key)).toBe(false);
    noWriter.dispose();
  });
});
