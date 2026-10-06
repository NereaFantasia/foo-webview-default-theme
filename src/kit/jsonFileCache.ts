import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';

export interface JsonFileCacheHost {
  readonly misc: Pick<typeof fb.misc, 'getProfilePath'>;
  readonly file: Pick<typeof fb.file, 'read' | 'write'>;
}

export interface JsonFileCacheState {
  readonly count: number;
  readonly bytes: number;
  readonly loaded: boolean;
  readonly clearing: boolean;
  readonly failed: boolean;
}

export const EMPTY_JSON_FILE_CACHE: JsonFileCacheState = {
  count: 0,
  bytes: 0,
  loaded: false,
  clearing: false,
  failed: false,
};

export interface JsonFileCacheOptions<T> {
  /** profile 下的目录名，各业务一个，如 `webview-ui-artists`。 */
  readonly directory: string;
  /** 目录里的文件名，格式变了就换个带版本号的名字。 */
  readonly file: string;
  readonly limit: number;
  /** 整个文件的字节上限；超出时从最久没用过的一项删起。 */
  readonly bytes: number;
  readonly key: (entry: T) => string;
  /** 按所属缓存的规则逐项校验，不可用答 null；是否保留过期条目由调用方决定。 */
  readonly read: (value: unknown, now: number) => T | null;
}

export interface JsonFileCache<T> {
  readonly ready: Promise<void>;
  get(key: string): T | undefined;
  /** entry 为 null 时删掉这一项。 */
  save(key: string, entry: T | null): Promise<boolean>;
  clear(): Promise<boolean>;
  dispose(): void;
}

const EMPTY_TEXT = JSON.stringify({ version: 1, entries: [] });

/**
 * 一份按键存取的 JSON 文件缓存。写入串行：较早发出的慢写不能盖掉较新的内容；清理前尚未发出的
 * 写入由代次挡住，已发出的写入之后再以空文件收尾。最近读过或写过的一项排到最后，超限时从头删。
 */
export function createJsonFileCache<T>(
  options: JsonFileCacheOptions<T>,
  host: JsonFileCacheHost,
  now: () => number = Date.now,
  changed: (state: JsonFileCacheState) => void = () => {},
): JsonFileCache<T> {
  const entries = new Map<string, T>();
  const size = (text: string) => new TextEncoder().encode(text).length;
  let path: string | null = null;
  let disposed = false;
  let writing: Promise<boolean> = Promise.resolve(true);
  let generation = 0;
  let clearing: Promise<boolean> | null = null;
  let state = EMPTY_JSON_FILE_CACHE;

  function publish(change: Partial<JsonFileCacheState>): void {
    state = { ...state, ...change };
    if (!disposed) changed(state);
  }

  async function hydrate(): Promise<void> {
    const mine = generation;
    const profile = await settle(() => host.misc.getProfilePath());
    if (disposed && !clearing) return;
    if (!profile || profile.success === false) {
      publish({ loaded: true, failed: true });
      return;
    }
    const filePath = `${profile.path.replace(/[\\/]+$/, '')}\\${options.directory}\\${options.file}`;
    path = filePath;
    if (disposed) return;
    const answer = await settle(() => host.file.read(filePath));
    if (disposed || mine !== generation) return;
    if (!answer || answer.success === false) {
      publish({ loaded: true, failed: !answer || answer.code !== 'NOT_FOUND' });
      return;
    }
    if (answer.content.length <= options.bytes) {
      try {
        const data: unknown = JSON.parse(answer.content);
        const list: unknown =
          typeof data === 'object' && data !== null && Reflect.get(data, 'version') === 1
            ? Reflect.get(data, 'entries')
            : null;
        const time = now();
        for (const item of Array.isArray(list) ? list.slice(-options.limit) : []) {
          const entry = options.read(item, time);
          if (entry) entries.set(options.key(entry), entry);
        }
      } catch {
        // 文件损坏时当作空缓存，下一次写入会盖掉它。
      }
    }
    publish({ loaded: true, count: entries.size, bytes: size(answer.content) });
  }

  function serialize(): string {
    let text = JSON.stringify({ version: 1, entries: [...entries.values()] });
    while (entries.size > options.limit || size(text) > options.bytes) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
      text = JSON.stringify({ version: 1, entries: [...entries.values()] });
    }
    return text;
  }

  function write(text: string, mine: number): Promise<boolean> {
    writing = writing.then(async () => {
      if (disposed || mine !== generation || !path) return false;
      const filePath = path;
      const answer = await settle(() => host.file.write(filePath, text));
      return answer?.success === true;
    });
    return writing;
  }

  const ready = hydrate();
  return {
    ready,
    get(key) {
      const entry = entries.get(key);
      if (entry !== undefined) {
        entries.delete(key);
        entries.set(key, entry);
      }
      return entry;
    },
    async save(key, entry) {
      const mine = generation;
      await ready;
      if (disposed || mine !== generation || clearing) return false;
      entries.delete(key);
      if (entry !== null) entries.set(key, entry);
      const text = serialize();
      const count = entries.size;
      const ok = await write(text, mine);
      if (mine === generation)
        publish({ failed: !ok, ...(ok ? { count, bytes: size(text) } : {}) });
      return ok;
    },
    clear() {
      if (disposed) return Promise.resolve(false);
      if (clearing) return clearing;
      generation += 1;
      entries.clear();
      publish({ clearing: true, failed: false });
      clearing = ready.then(async () => {
        // 已发起的清空必须收尾；释放只取消普通排队写入与状态通知。
        writing = writing.then(async () => {
          if (!path) return false;
          const filePath = path;
          const answer = await settle(() => host.file.write(filePath, EMPTY_TEXT));
          return answer?.success === true;
        });
        const ok = await writing;
        publish({
          loaded: true,
          clearing: false,
          failed: !ok,
          ...(ok ? { count: 0, bytes: size(EMPTY_TEXT) } : {}),
        });
        clearing = null;
        return ok;
      });
      return clearing;
    },
    dispose() {
      disposed = true;
      entries.clear();
    },
  };
}
