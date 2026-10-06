import {
  createDataWriter,
  DATA_GENERATION_KEY,
  DATA_GENERATION_PREFIX,
  type DataWriter,
  type DataWriteOptions,
  type DataWriteResult,
  type DataWriteStorage,
} from './dataWrite.ts';

const DATABASE_NAME = 'default-theme.data.v1';
const VALUES_STORE = 'values';

export interface BrowserDataStorageOptions {
  readonly database: Pick<IDBFactory, 'open'>;
  readonly legacy: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  readonly name?: string;
}

export interface BrowserDataStorage extends DataWriteStorage {
  /**
   * 一次事务读出数据库里全部业务键，不含代数；用户清除过的键为 null，原存储里的兼容值不在其中。
   * 格式不对的值也给 null：一个坏键不连累其他键，也不退回兼容值掩盖损坏，下次写入时覆盖它。
   */
  entries(): Promise<ReadonlyMap<string, string | null>>;
  dispose(): void;
}

function isGenerationKey(key: string): boolean {
  return key === DATA_GENERATION_KEY || key.startsWith(DATA_GENERATION_PREFIX);
}

/**
 * IndexedDB 保存可信副本；数据库没有的业务键先读原存储，写入时保留原键的兼容值。
 * 每次调用使用短事务，等 complete 才兑现，避免窗口接过写锁后仍读到上一个窗口的旧缓存。
 */
export function createBrowserDataStorage(options: BrowserDataStorageOptions): BrowserDataStorage {
  let disposed = false;
  let connection: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;

  function dispose(): void {
    disposed = true;
    connection?.close();
    connection = undefined;
  }

  function database(): Promise<IDBDatabase> {
    if (disposed) return Promise.reject(new Error('存储已关闭'));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = options.database.open(options.name ?? DATABASE_NAME, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(VALUES_STORE)) {
          request.result.createObjectStore(VALUES_STORE);
        }
      };
      request.onblocked = () => {
        rejected = true;
        reject(new Error('其他窗口阻止了存储打开'));
      };
      request.onerror = () => reject(request.error ?? new Error('存储打开失败'));
      request.onsuccess = () => {
        const db = request.result;
        if (disposed || rejected) {
          db.close();
          reject(new Error('存储已关闭'));
          return;
        }
        connection = db;
        db.onversionchange = dispose;
        resolve(db);
      };
    });
    return opening;
  }

  async function transact<T>(
    mode: IDBTransactionMode,
    requestOf: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await database();
    if (disposed) throw new Error('存储已关闭');
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(VALUES_STORE, mode);
      const request = requestOf(transaction.objectStore(VALUES_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('存储事务中断'));
      transaction.onerror = () => reject(transaction.error ?? new Error('存储事务失败'));
    });
  }

  return {
    async getItem(key) {
      const values: unknown[] = await transact('readonly', (store) => store.getAll(key, 1));
      if (values.length === 0)
        return isGenerationKey(key) ? null : (options.legacy?.getItem(key) ?? null);
      const value = values[0];
      if (value === null || typeof value === 'string') return value;
      throw new Error('存储值的格式不正确');
    },
    async setItem(key, value) {
      await database();
      if (disposed) throw new Error('存储已关闭');
      if (!isGenerationKey(key)) options.legacy?.setItem(key, value);
      await transact('readwrite', (store) => store.put(value, key));
    },
    async removeItem(key) {
      await database();
      if (disposed) throw new Error('存储已关闭');
      if (!isGenerationKey(key)) options.legacy?.removeItem(key);
      // 空值保留用户清除的事实，避免再次从旧键恢复已经删掉的值。
      await transact('readwrite', (store) => store.put(null, key));
    },
    async entries() {
      const db = await database();
      if (disposed) throw new Error('存储已关闭');
      const [keys, values] = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
        const transaction = db.transaction(VALUES_STORE, 'readonly');
        const store = transaction.objectStore(VALUES_STORE);
        // 同一个只读事务里的两次读取看到同一份数据，按键升序一一对应。
        const keyRequest = store.getAllKeys();
        const valueRequest = store.getAll();
        transaction.oncomplete = () => resolve([keyRequest.result, valueRequest.result]);
        transaction.onabort = () => reject(transaction.error ?? new Error('存储事务中断'));
        transaction.onerror = () => reject(transaction.error ?? new Error('存储事务失败'));
      });
      const result = new Map<string, string | null>();
      keys.forEach((key, index) => {
        const value = values[index];
        if (typeof key !== 'string' || isGenerationKey(key)) return;
        result.set(key, typeof value === 'string' ? value : null);
      });
      return result;
    },
    dispose,
  };
}

export interface BrowserDataWriter extends DataWriter {
  /** 读出数据库里的全部业务键；数据库或写锁不可用时明确失败，不改读原存储。 */
  readAll(): Promise<DataWriteResult<ReadonlyMap<string, string | null>>>;
  /** 取消等锁的请求；已经持锁的写入完成后再关闭数据库。 */
  dispose(): void;
}

/** 每个页面由装配层持有一份，业务经传入的 run 共享它的生命周期。 */
export function startBrowserDataWriter(): BrowserDataWriter {
  let storage: BrowserDataStorage | null = null;
  let legacy: BrowserDataStorageOptions['legacy'] = null;
  let locks: DataWriteOptions['locks'];
  try {
    legacy = typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 原存储被禁不影响数据库中的宿主配置代数；尚未导入的浏览器偏好仍需由调用方处理。
  }
  try {
    if (typeof indexedDB !== 'undefined') {
      storage = createBrowserDataStorage({ database: indexedDB, legacy });
    }
    locks = typeof navigator === 'undefined' ? null : (navigator.locks ?? null);
  } catch {
    locks = null;
  }
  const writer = createDataWriter({ storage, locks });
  const lifetime = new AbortController();
  let active = 0;
  return {
    async run(work, signal) {
      active += 1;
      try {
        return await writer.run(
          work,
          signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal,
        );
      } finally {
        active -= 1;
        if (lifetime.signal.aborted && active === 0) storage?.dispose();
      }
    },
    async readAll() {
      if (!storage || !locks || lifetime.signal.aborted) {
        return { success: false, reason: 'unavailable' };
      }
      active += 1;
      try {
        return { success: true, value: await storage.entries() };
      } catch {
        return { success: false, reason: 'unavailable' };
      } finally {
        active -= 1;
        if (lifetime.signal.aborted && active === 0) storage.dispose();
      }
    },
    dispose() {
      lifetime.abort();
      if (active === 0) storage?.dispose();
    },
  };
}
