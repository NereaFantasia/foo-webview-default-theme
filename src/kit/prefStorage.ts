import type { DataWriteFailure, DataWriteResult, DataWriter } from './dataWrite.ts';
import type { PrefStorage } from './localPref.ts';
import { atom } from 'jotai/vanilla';
import { serviceKey } from './serviceKey.ts';

/** 启动时最多等可信存储这么久（毫秒）；超时按不可用处理，免得页面一直不出。 */
export const PREF_STORAGE_TIMEOUT_MS = 3000;

export type PrefSaveState =
  | { readonly status: 'pending' }
  | { readonly status: 'saved'; readonly generation: number }
  | { readonly status: 'failed'; readonly reason: DataWriteFailure };

export interface PrefStorageSource {
  readAll(): Promise<DataWriteResult<ReadonlyMap<string, string | null>>>;
  readonly run: DataWriter['run'];
}

/**
 * 页面的浏览器偏好存储。打开时一次读出可信副本，之后同步读内存：数据库有记录的键以它为准（null 是用户
 * 清除过），没有记录的才读原 localStorage 的兼容值。写入立即改内存，再经写入助手排队落盘；同一个键在上一
 * 次落盘结束前又改了，只再写最新一份。写入失败保留内存里的值，按键记下失败。
 *
 * 可信存储不可用（打不开、超时、没有写锁）时仍读兼容值供本次显示，写入只改内存并记为失败，不改用无锁写入。
 */
export interface PagePrefStorage extends PrefStorage {
  /** 可信存储读成了，写入会落盘。 */
  readonly available: boolean;
  removeItem(key: string): void;
  /** 这个键本次启动以来最近一次写入的结果；没写过时为 undefined。 */
  saveState(key: string): PrefSaveState | undefined;
  /** 同一份快照保持到下一次状态变化，订阅者可据此更新界面。 */
  snapshot(): ReadonlyMap<string, PrefSaveState>;
  subscribe(listener: () => void): () => void;
  /** 只重试失败键的当前值；启动时存储不可用时仍明确失败，不绕过写锁。 */
  retry(key: string): Promise<boolean>;
  settled(): Promise<void>;
  /** 取消还在等写锁的写入；已经持锁的照常完成。 */
  dispose(): void;
}

export async function openPrefStorage(
  source: PrefStorageSource,
  legacy: Pick<Storage, 'getItem'> | null,
  timeoutMs = PREF_STORAGE_TIMEOUT_MS,
): Promise<PagePrefStorage> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = await Promise.race([
    source.readAll(),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  const available = read?.success === true;
  const values = new Map<string, string | null>(read?.success ? read.value : []);
  const queued = new Map<string, string | null>();
  const flushing = new Set<string>();
  let states: ReadonlyMap<string, PrefSaveState> = new Map();
  const listeners = new Set<() => void>();
  const tasks = new Set<Promise<void>>();
  const lifetime = new AbortController();
  let disposed = false;

  function report(key: string, state: PrefSaveState): void {
    if (disposed) return;
    states = new Map(states).set(key, state);
    for (const listener of listeners) listener();
  }

  async function flush(key: string): Promise<void> {
    flushing.add(key);
    while (!disposed && queued.has(key)) {
      const value = queued.get(key) ?? null;
      queued.delete(key);
      const result = await source
        .run((scope) => scope.setLocal(key, value), lifetime.signal)
        .catch(() => ({ success: false as const, reason: 'write-failed' as const }));
      // 落盘期间又改了：这次的结果由下一轮写入取代。
      if (disposed || queued.has(key)) continue;
      report(
        key,
        result.success
          ? { status: 'saved', generation: result.value }
          : { status: 'failed', reason: result.reason },
      );
    }
    // 退出与上面最后一次检查在同一段同步代码里：之后到的写入会另起一轮。
    flushing.delete(key);
  }

  function save(key: string, value: string | null): void {
    if (disposed) return;
    values.set(key, value);
    if (!available) {
      report(key, { status: 'failed', reason: 'unavailable' });
      return;
    }
    queued.set(key, value);
    report(key, { status: 'pending' });
    if (!flushing.has(key)) {
      const task = flush(key);
      tasks.add(task);
      void task.then(() => tasks.delete(task));
    }
  }

  async function settled(): Promise<void> {
    await Promise.all([...tasks]);
  }

  return {
    available,
    getItem(key) {
      if (values.has(key)) return values.get(key) ?? null;
      try {
        return legacy?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: save,
    removeItem: (key) => save(key, null),
    saveState: (key) => states.get(key),
    snapshot: () => states,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async retry(key) {
      if (disposed || states.get(key)?.status !== 'failed') return false;
      save(key, values.get(key) ?? null);
      await settled();
      return !disposed && states.get(key)?.status === 'saved';
    },
    settled,
    dispose() {
      disposed = true;
      lifetime.abort();
      listeners.clear();
    },
  };
}

/** 页面装配订阅偏好存储后发布；不可用与单项失败分开，尚未改设置时也能说明保存受限。 */
export const prefStorageAvailableAtom = atom(true);
export const prefSaveStatesAtom = atom<ReadonlyMap<string, PrefSaveState>>(new Map());
export const prefStorageKey = serviceKey<Pick<PagePrefStorage, 'retry'>>('prefStorage');

/** 页面用的一份：兼容值读页面的 localStorage，被禁时不读。 */
export function openBrowserPrefStorage(source: PrefStorageSource): Promise<PagePrefStorage> {
  let legacy: Pick<Storage, 'getItem'> | null = null;
  try {
    legacy = typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 原存储被禁时只读可信副本。
  }
  return openPrefStorage(source, legacy);
}
