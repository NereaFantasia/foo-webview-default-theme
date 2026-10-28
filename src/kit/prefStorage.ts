import type { DataWriteFailure, DataWriteResult, DataWriter } from './dataWrite.ts';
import type { PrefStorage } from './localPref.ts';
import { atom } from 'jotai/vanilla';
import { serviceKey } from './serviceKey.ts';

/** 启动初始化等待底层可信存储就绪的超时上限（毫秒，默认 3000 ms）；超时后降级运行以避免白屏 */
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
 * 页面偏好存储接口
 * 初始化时全量读取持久化副本并缓存在内存，后续读取均为同步内存操作；
 * 写入时立即同步更新内存，并经数据写入互斥器异步排队刷盘。若在刷盘期间再次修改，仅排队写入最新值；
 * 若写入失败则保留内存状态并在该键上记录错误状态
 *
 * 当底层可信存储不可用（损坏、超时或缺少写锁支持）时，回退读取本地兼容值，写入仅保留于内存并标记失败，
 * 绝不绕过写锁进行无保护写入
 */
export interface PagePrefStorage extends PrefStorage {
  /** 指示底层可信存储是否成功就绪且支持异步刷盘 */
  readonly available: boolean;
  removeItem(key: string): void;
  /** 查询指定键自本次启动以来的最新写入状态；未触发过写入时返回 undefined */
  saveState(key: string): PrefSaveState | undefined;
  /** 获取所有键保存状态的只读快照；状态变化前保持引用稳定 */
  snapshot(): ReadonlyMap<string, PrefSaveState>;
  subscribe(listener: () => void): () => void;
  /** 重试指定处于失败状态的键的当前内存值；若底层存储整体不可用则依然返回失败，不绕开锁保护 */
  retry(key: string): Promise<boolean>;
  settled(): Promise<void>;
  /** 释放资源并取消排队等待写锁的任务；已获取锁的任务将执行完毕 */
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
      // 落盘期间又改了：这次的结果由下一轮写入取代
      if (disposed || queued.has(key)) continue;
      report(
        key,
        result.success
          ? { status: 'saved', generation: result.value }
          : { status: 'failed', reason: result.reason },
      );
    }
    // 退出与上面最后一次检查在同一段同步代码里：之后到的写入会另起一轮
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

/** 页面装配订阅偏好存储后发布；不可用与单项失败分开，尚未改设置时也能说明保存受限 */
export const prefStorageAvailableAtom = atom(true);
export const prefSaveStatesAtom = atom<ReadonlyMap<string, PrefSaveState>>(new Map());
export const prefStorageKey = serviceKey<Pick<PagePrefStorage, 'retry'>>('prefStorage');

/** 页面用的一份：兼容值读页面的 localStorage，被禁时不读 */
export function openBrowserPrefStorage(source: PrefStorageSource): Promise<PagePrefStorage> {
  let legacy: Pick<Storage, 'getItem'> | null = null;
  try {
    legacy = typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 原存储被禁时只读可信副本
  }
  return openPrefStorage(source, legacy);
}
