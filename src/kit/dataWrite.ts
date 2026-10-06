const WRITE_LOCK = 'default-theme.data-write.v1';
export const DATA_GENERATION_KEY = 'default-theme.data-gen.v1';
export const DATA_GENERATION_PREFIX = `${DATA_GENERATION_KEY}.`;

/** 写入兑现后，其他窗口的新读取必须能看到它；不能用有跨窗缓存的同步存储代替。 */
export interface DataWriteStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface DataWriteOptions {
  readonly storage: DataWriteStorage | null;
  readonly locks: Pick<LockManager, 'request'> | null;
  /** 毫秒时间；时钟回拨时改由已保存的计数器保证递增。 */
  readonly now?: () => number;
}

export interface DataFormat {
  readonly id: string;
  readonly keys: readonly string[];
  /** 在同一写入锁内读取的值是否存在，用于所有格式都没有代数的首次迁移。 */
  readonly hasValue: boolean;
}

export type DataWriteFailure =
  | 'unavailable'
  | 'aborted'
  | 'invalid-generation'
  | 'invalid-key'
  | 'write-failed'
  | 'scope-closed';

export type DataWriteResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly reason: DataWriteFailure };

/** 只在 run 的回调内使用；迁移的读源、转换与写目标都放在这个回调里。 */
export interface DataWriteScope {
  readLocal(key: string): Promise<string | null>;
  generation(key: string): Promise<number>;
  /** 同代数时保留当前格式；全为零且当前没有值时，取 previous 中第一个有值的格式。 */
  latestFormat(current: DataFormat, previous: readonly DataFormat[]): Promise<DataFormat>;
  /** null 表示用户主动清除；返回此次写入的代数。 */
  setLocal(key: string, value: string | null): Promise<number>;
  /** persist 返回 true 后才记代数；外部存储的 key 加命名空间，例如 config:defaultTheme.locale。 */
  write(key: string, persist: () => boolean | Promise<boolean>): Promise<number>;
}

export interface DataWriter {
  /**
   * signal 只取消尚未获锁的请求；已经开始的写入要完成代数记录后才释放锁。
   * 同一回调的写入按发起顺序执行；失败保留已经完成的写入，不自动回滚。
   */
  run<T>(
    work: (scope: DataWriteScope) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<DataWriteResult<T>>;
}

class DataWriteFault extends Error {
  constructor(readonly reason: DataWriteFailure) {
    super(reason);
  }
}

function checkKey(key: string): void {
  if (!key || key === DATA_GENERATION_KEY || key.startsWith(DATA_GENERATION_PREFIX)) {
    throw new DataWriteFault('invalid-key');
  }
}

function parseGeneration(raw: string | null): number {
  if (raw === null) return 0;
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw new DataWriteFault('invalid-generation');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new DataWriteFault('invalid-generation');
  return value;
}

function failureOf(error: unknown): DataWriteFailure {
  if (error instanceof DataWriteFault) return error.reason;
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return 'write-failed';
}

/**
 * 同源窗口共用一把浏览器锁。它保护并发顺序，不保证值与代数在进程崩溃时一起落盘。
 * 不使用抢锁或超时接管；持锁页面挂起时，其他页面等待它恢复或销毁。
 */
export function createDataWriter(options: DataWriteOptions): DataWriter {
  const { storage, locks, now = Date.now } = options;

  async function run<T>(
    work: (scope: DataWriteScope) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<DataWriteResult<T>> {
    if (!storage || !locks) return { success: false, reason: 'unavailable' };
    const targetStorage = storage;
    let acquired = false;
    try {
      return await locks.request(
        WRITE_LOCK,
        { mode: 'exclusive', signal },
        async (): Promise<DataWriteResult<T>> => {
          acquired = true;
          let open = true;
          let failed = false;
          let firstError: unknown;
          let pending = Promise.resolve();

          function ensureOpen(): void {
            if (!open) throw new DataWriteFault('scope-closed');
          }

          async function generation(key: string): Promise<number> {
            ensureOpen();
            checkKey(key);
            return parseGeneration(await targetStorage.getItem(`${DATA_GENERATION_PREFIX}${key}`));
          }

          function enqueue(action: () => Promise<number>): Promise<number> {
            ensureOpen();
            const operation = pending.then(() => {
              if (failed) throw firstError;
              return action();
            });
            pending = operation.then(
              () => undefined,
              (error: unknown) => {
                if (!failed) firstError = error;
                failed = true;
              },
            );
            return operation;
          }

          function write(key: string, persist: () => boolean | Promise<boolean>): Promise<number> {
            checkKey(key);
            return enqueue(async () => {
              const clock = now();
              const next = Math.max(
                parseGeneration(await targetStorage.getItem(DATA_GENERATION_KEY)) + 1,
                clock,
              );
              // 在写值之前拒绝坏计数或溢出，避免明知无法记代数仍改动数据。
              if (!Number.isSafeInteger(clock) || clock < 0 || !Number.isSafeInteger(next)) {
                throw new DataWriteFault('invalid-generation');
              }
              if (!(await persist())) throw new DataWriteFault('write-failed');
              await targetStorage.setItem(DATA_GENERATION_KEY, String(next));
              await targetStorage.setItem(`${DATA_GENERATION_PREFIX}${key}`, String(next));
              return next;
            });
          }

          const scope: DataWriteScope = {
            async readLocal(key) {
              ensureOpen();
              checkKey(key);
              return targetStorage.getItem(key);
            },
            generation,
            async latestFormat(current, previous) {
              ensureOpen();
              const score = async (format: DataFormat) =>
                Math.max(0, ...(await Promise.all(format.keys.map(generation))));
              let latest = current;
              let maximum = await score(current);
              for (const candidate of previous) {
                const candidateScore = await score(candidate);
                if (candidateScore > maximum) {
                  latest = candidate;
                  maximum = candidateScore;
                }
              }
              if (maximum === 0 && !current.hasValue) {
                return previous.find((candidate) => candidate.hasValue) ?? current;
              }
              return latest;
            },
            setLocal(key, value) {
              return write(key, async () => {
                if (value === null) await targetStorage.removeItem(key);
                else await targetStorage.setItem(key, value);
                return true;
              });
            },
            write,
          };

          try {
            const value = await work(scope);
            open = false;
            // 即使调用者漏等一次写入，也要把已经发出的写入收完，不能提前释放跨窗口锁。
            await pending;
            if (failed) throw firstError;
            return { success: true, value };
          } finally {
            open = false;
            await pending;
          }
        },
      );
    } catch (error) {
      if (!acquired && signal?.aborted) return { success: false, reason: 'aborted' };
      return { success: false, reason: failureOf(error) };
    }
  }

  return { run };
}
