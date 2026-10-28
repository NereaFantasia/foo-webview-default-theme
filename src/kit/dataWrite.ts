const WRITE_LOCK = 'default-theme.data-write.v1';
export const DATA_GENERATION_KEY = 'default-theme.data-gen.v1';
export const DATA_GENERATION_PREFIX = `${DATA_GENERATION_KEY}.`;

/** 跨窗口共享的数据存储接口。写入完成后必须对其他窗口立即可见，避免使用带跨窗缓存的同步存储 */
export interface DataWriteStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface DataWriteOptions {
  readonly storage: DataWriteStorage | null;
  readonly locks: Pick<LockManager, 'request'> | null;
  /** 当前时间戳获取函数（毫秒）。系统时钟回拨时由已持久化的代数计数器兜底保证单调递增 */
  readonly now?: () => number;
}

export interface DataFormat {
  readonly id: string;
  readonly keys: readonly string[];
  /** 指示当前格式在同一写锁内读取时是否存在有效值，用于所有格式均无代数记录时的首次数据迁移 */
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

/** 写入事务作用域，仅在 `DataWriter.run` 的回调执行期间有效；负责协调读取、格式判定与代数更新 */
export interface DataWriteScope {
  readLocal(key: string): Promise<string | null>;
  generation(key: string): Promise<number>;
  /** 格式仲裁：代数相同保留当前格式；全为零且当前格式无值时，回退取 `previous` 中首个有值的旧格式 */
  latestFormat(current: DataFormat, previous: readonly DataFormat[]): Promise<DataFormat>;
  /** 设置本地值（null 表示主动清除），返回本次写入生成的递增代数 */
  setLocal(key: string, value: string | null): Promise<number>;
  /** 外部持久化成功（返回 true）后递增代数；外部存储键名须携带命名空间前缀（如 `config:defaultTheme.locale`） */
  write(key: string, persist: () => boolean | Promise<boolean>): Promise<number>;
}

export interface DataWriter {
  /**
   * 执行带排他写锁的数据操作事务
   * - `signal` 仅用于取消排队等待获锁的请求；一旦进入执行阶段，必须等待当前代数持久化完成才释放锁；
   * - 同一作用域内的写入按顺序串行执行；若中途失败则保留已完成的写入操作，不执行自动回滚
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
 * 创建基于 Web Locks API 的跨窗口数据写入互斥器
 * 保护跨窗口并发写入的时序一致性；采用排他锁机制，若持锁页面挂起，其他页面将等待其恢复或被浏览器释放
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
              // 在写值之前拒绝坏计数或溢出，避免明知无法记代数仍改动数据
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
            // 即使调用者漏等一次写入，也要把已经发出的写入收完，不能提前释放跨窗口锁
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
