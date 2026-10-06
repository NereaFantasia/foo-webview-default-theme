import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  createDataWriter,
  DATA_GENERATION_PREFIX,
  type DataWriteStorage,
} from '../../../src/kit/dataWrite.ts';
import {
  openPrefStorage,
  type PagePrefStorage,
  type PrefSaveState,
  type PrefStorageSource,
} from '../../../src/kit/prefStorage.ts';
import { createMemoryDataWriter, occupyWriteLock } from '../../fixtures/dataWriter.ts';

const KEY = 'default-theme.sample.v1';

afterEach(() => vi.useRealTimers());

function legacyOf(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: (key: string) => map.get(key) ?? null };
}

async function open(
  options: {
    trusted?: Record<string, string | null>;
    legacy?: Record<string, string>;
    storage?: (memory: DataWriteStorage) => DataWriteStorage;
  } = {},
) {
  const data = createMemoryDataWriter();
  const writer = options.storage
    ? createDataWriter({
        storage: options.storage(data.storage),
        locks: navigator.locks,
        now: () => 0,
      })
    : data.writer;
  const source: PrefStorageSource = {
    readAll: async () => ({ success: true, value: new Map(Object.entries(options.trusted ?? {})) }),
    run: writer.run,
  };
  const prefs = await openPrefStorage(source, legacyOf(options.legacy));
  onTestFinished(() => prefs.dispose());
  /** 写锁先来先得：排到这次时，之前发起的写入都已执行完。 */
  const written = () => writer.run(() => undefined);
  return { prefs, data, writer, written };
}

describe('openPrefStorage', () => {
  it('订阅保存结果，重试只写失败键，成功后清除失败而不改变当前值', async () => {
    let failing = true;
    const other = 'default-theme.other.v1';
    const { prefs, data } = await open({
      storage: (memory) => ({
        ...memory,
        setItem: async (key, value) => {
          if (key === KEY && failing) throw new Error('写入失败');
          await memory.setItem(key, value);
        },
      }),
    });
    const states: (PrefSaveState['status'] | undefined)[] = [];
    const before = prefs.snapshot();
    const off = prefs.subscribe(() => states.push(prefs.snapshot().get(KEY)?.status));
    prefs.setItem(KEY, 'chosen');
    prefs.setItem(other, 'kept');
    await prefs.settled();
    expect(before.size).toBe(0);
    expect(prefs.snapshot().get(KEY)?.status).toBe('failed');
    expect(prefs.snapshot().get(other)?.status).toBe('saved');
    const otherGeneration = data.values.get(`${DATA_GENERATION_PREFIX}${other}`);
    failing = false;
    expect(await prefs.retry(KEY)).toBe(true);
    expect(prefs.getItem(KEY)).toBe('chosen');
    expect(data.values.get(KEY)).toBe('chosen');
    expect(data.values.get(`${DATA_GENERATION_PREFIX}${other}`)).toBe(otherGeneration);
    expect(states).toContain('failed');
    expect(states.at(-1)).toBe('saved');
    expect(await prefs.retry(other)).toBe(false);
    off();
    const recorded = [...states];
    prefs.setItem(KEY, 'later');
    await prefs.settled();
    expect(states).toEqual(recorded);
  });

  it('重试排队时又改了值，落盘与状态以最后一次选择为准', async () => {
    let failing = true;
    const { prefs, data, writer } = await open({
      storage: (memory) => ({
        ...memory,
        setItem: async (key, value) => {
          if (key === KEY && failing) throw new Error('写入失败');
          await memory.setItem(key, value);
        },
      }),
    });
    prefs.setItem(KEY, 'old');
    await prefs.settled();
    const release = await occupyWriteLock(writer);
    const retry = prefs.retry(KEY);
    prefs.setItem(KEY, 'latest');
    failing = false;
    await release();
    expect(await retry).toBe(true);
    expect(data.values.get(KEY)).toBe('latest');
    expect(prefs.saveState(KEY)?.status).toBe('saved');
  });

  it('存储不可用时重试仍明确失败；释放后的订阅不收迟到结果', async () => {
    const memory = createMemoryDataWriter();
    const source: PrefStorageSource = {
      readAll: async () => ({ success: false, reason: 'unavailable' }),
      run: memory.writer.run,
    };
    const prefs = await openPrefStorage(source, null);
    prefs.setItem(KEY, 'memory');
    expect(await prefs.retry(KEY)).toBe(false);
    expect(prefs.snapshot().get(KEY)).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(memory.values.size).toBe(0);
    prefs.dispose();
    const listener = vi.fn();
    prefs.subscribe(listener);
    expect(await prefs.retry(KEY)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    const pending = await open();
    const changed = vi.fn();
    pending.prefs.subscribe(changed);
    const release = await occupyWriteLock(pending.writer);
    pending.prefs.setItem(KEY, 'queued');
    pending.prefs.dispose();
    changed.mockClear();
    await release();
    await pending.prefs.settled();
    expect(changed).not.toHaveBeenCalled();
    expect(pending.data.values.has(KEY)).toBe(false);
  });

  it('数据库有记录的键以它为准，清除过的为 null；没有记录的才读兼容值', async () => {
    const { prefs } = await open({
      trusted: { [KEY]: 'trusted', 'default-theme.cleared.v1': null },
      legacy: {
        [KEY]: 'stale',
        'default-theme.cleared.v1': 'old',
        'default-theme.new.v1': 'compat',
      },
    });
    expect(prefs.available).toBe(true);
    expect(prefs.getItem(KEY)).toBe('trusted');
    expect(prefs.getItem('default-theme.cleared.v1')).toBeNull();
    expect(prefs.getItem('default-theme.new.v1')).toBe('compat');
    expect(prefs.getItem('default-theme.missing.v1')).toBeNull();
  });

  it('兼容值读抛错时按没有存档', async () => {
    const source: PrefStorageSource = {
      readAll: async () => ({ success: true, value: new Map() }),
      run: createMemoryDataWriter().writer.run,
    };
    const prefs = await openPrefStorage(source, {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    onTestFinished(() => prefs.dispose());
    expect(prefs.getItem(KEY)).toBeNull();
  });

  it('写入立即可读，随后经写入助手落盘并记代数', async () => {
    const { prefs, data, written } = await open();
    prefs.setItem(KEY, 'one');
    expect(prefs.getItem(KEY)).toBe('one');
    expect(prefs.saveState(KEY)).toEqual({ status: 'pending' });
    await written();
    await vi.waitFor(() =>
      expect(prefs.saveState(KEY)).toEqual({ status: 'saved', generation: 1 }),
    );
    expect(data.values.get(KEY)).toBe('one');
    expect(data.values.get(`${DATA_GENERATION_PREFIX}${KEY}`)).toBe('1');
  });

  it('清除记成 null 并记代数，不再回落到兼容值', async () => {
    const { prefs, data, written } = await open({ legacy: { [KEY]: 'compat' } });
    prefs.removeItem(KEY);
    expect(prefs.getItem(KEY)).toBeNull();
    await written();
    await vi.waitFor(() => expect(prefs.saveState(KEY)).toMatchObject({ status: 'saved' }));
    expect(data.values.has(KEY)).toBe(false);
    expect(data.values.get(`${DATA_GENERATION_PREFIX}${KEY}`)).toBe('1');
  });

  it('落盘期间连改几次，只再写最新一份', async () => {
    const writes: string[] = [];
    const { prefs, writer, written } = await open({
      storage: (memory) => ({
        ...memory,
        setItem: async (key, value) => {
          if (key === KEY) writes.push(value);
          await memory.setItem(key, value);
        },
      }),
    });
    const release = await occupyWriteLock(writer);
    prefs.setItem(KEY, 'a');
    prefs.setItem(KEY, 'b');
    prefs.setItem(KEY, 'c');
    await release();
    await written();
    await vi.waitFor(() => expect(prefs.saveState(KEY)).toMatchObject({ status: 'saved' }));
    expect(writes).toEqual(['a', 'c']);
    expect(prefs.getItem(KEY)).toBe('c');
  });

  it('写入失败保留内存里的值并按键记下；被后一次写入取代的失败不记', async () => {
    let failures = 1;
    const opened: { prefs?: PagePrefStorage } = {};
    let during: PrefSaveState | undefined;
    const { prefs, writer, written } = await open({
      storage: (memory) => ({
        ...memory,
        setItem: async (key, value) => {
          if (value === 'second') during = opened.prefs?.saveState(KEY);
          if (key === KEY && failures > 0) {
            failures -= 1;
            throw new Error('写满了');
          }
          await memory.setItem(key, value);
        },
      }),
    });
    opened.prefs = prefs;
    const release = await occupyWriteLock(writer);
    prefs.setItem(KEY, 'first');
    prefs.setItem(KEY, 'second');
    await release();
    await written();
    await vi.waitFor(() => expect(prefs.saveState(KEY)).toMatchObject({ status: 'saved' }));
    // 第一份失败时第二份已经排上，失败不记，第二份落盘时仍是待写。
    expect(during).toEqual({ status: 'pending' });

    failures = 1;
    prefs.setItem(KEY, 'third');
    await written();
    await vi.waitFor(() =>
      expect(prefs.saveState(KEY)).toEqual({ status: 'failed', reason: 'write-failed' }),
    );
    expect(prefs.getItem(KEY)).toBe('third');
  });

  it('可信存储读不成：读兼容值供本次显示，写入只改内存并记为不可用', async () => {
    const memory = createMemoryDataWriter();
    const prefs = await openPrefStorage(
      { readAll: async () => ({ success: false, reason: 'unavailable' }), run: memory.writer.run },
      legacyOf({ [KEY]: 'compat' }),
    );
    onTestFinished(() => prefs.dispose());
    expect(prefs.available).toBe(false);
    expect(prefs.getItem(KEY)).toBe('compat');
    prefs.setItem(KEY, 'memory');
    expect(prefs.getItem(KEY)).toBe('memory');
    expect(prefs.saveState(KEY)).toEqual({ status: 'failed', reason: 'unavailable' });
    await memory.writer.run(() => undefined);
    expect(memory.values.size).toBe(0);
  });

  it('可信存储迟迟不答：到时按不可用打开，不让页面一直等', async () => {
    vi.useFakeTimers();
    const opening = openPrefStorage(
      { readAll: () => new Promise(() => {}), run: createMemoryDataWriter().writer.run },
      legacyOf({ [KEY]: 'compat' }),
      50,
    );
    await vi.advanceTimersByTimeAsync(50);
    const prefs = await opening;
    onTestFinished(() => prefs.dispose());
    expect(prefs.available).toBe(false);
    expect(prefs.getItem(KEY)).toBe('compat');
  });

  it('释放时取消仍在等写锁的写入', async () => {
    const { prefs, data, writer, written } = await open();
    const release = await occupyWriteLock(writer);
    prefs.setItem(KEY, 'late');
    prefs.dispose();
    await release();
    await written();
    expect(data.values.size).toBe(0);
    prefs.setItem(KEY, 'after');
    expect(prefs.getItem(KEY)).toBe('late');
  });
});
