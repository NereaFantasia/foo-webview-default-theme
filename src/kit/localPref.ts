import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from './store.ts';

/** 偏好用到的存储方法；传 null 时只在内存里记。页面上是 `prefStorage.ts` 的那一份，写入异步落盘。 */
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let pageStorage: PrefStorage | null = null;

/** 装配层读完可信存储之后装上页面的偏好存储，释放时装回 null。 */
export function installPrefStorage(storage: PrefStorage | null): void {
  pageStorage = storage;
}

/** 页面的偏好存储；还没装上时为 null，只在内存里记。业务拿不到原始的 localStorage。 */
export function browserStorage(): PrefStorage | null {
  return pageStorage;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 是普通对象（不是数组、不是 null）就原样给，否则给空对象，各项再按缺省补。 */
export function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

/** 存成 JSON 对象的存档读成对象；没有存档、不是 JSON、不是对象都给空对象。 */
export function storedRecord(raw: string | null): Readonly<Record<string, unknown>> {
  if (raw === null) return {};
  try {
    return recordOf(JSON.parse(raw));
  } catch {
    return {};
  }
}

export interface LocalPrefSpec<T> {
  /**
   * `default-theme.<区域>.v<N>`。已发布的键不改名；改格式就换新键，旧键留给回滚的旧版本读。
   * 换键时的迁移要在写锁里按写入代数选源，不能只看新键有没有存档。
   */
  readonly key: string;
  /** 没有存档、存储读不了或存档认不出时的值。 */
  readonly fallback: T;
  /** 存档文本归一成值，认不出答 undefined。对象形的存档逐项校验，坏了哪一项补哪一项，不整份丢掉。 */
  readonly parse: (raw: string) => T | undefined;
  /** 写进存档的文本，`parse` 要能原样读回。存档格式与键一样是契约，改写法要换键。 */
  readonly format: (value: T) => string;
}

/** 存档的写法：读法与写法成对，`parse` 要能原样读回 `format` 写出的文本。 */
export type PrefCodec<T> = Pick<LocalPrefSpec<T>, 'parse' | 'format'>;

/** 开关存 `on` / `off`；别的取值认不出，按缺省。 */
export const ON_OFF: PrefCodec<boolean> = {
  parse: (raw) => (raw === 'on' ? true : raw === 'off' ? false : undefined),
  format: (value) => (value ? 'on' : 'off'),
};

/** 取值表里的一项，存取值本身的文本，不是 JSON；不在表里的认不出，按缺省。 */
export function choiceCodec<T extends string | number>(choices: readonly T[]): PrefCodec<T> {
  return {
    parse: (raw) => choices.find((choice) => String(choice) === raw),
    format: (value) => String(value),
  };
}

/**
 * 一项随这台机器记住的偏好，不随 profile：启动时页面的偏好存储读完之后，同步读得到，不等宿主。
 * 要随 profile 记住、能等宿主就绪的偏好用 `host/configPref.ts`。
 *
 * 在模块顶层用 `defineLocalPref` 定义一次，值按 store 各存一份。各方法不给 `storage` 时用页面的
 * 偏好存储，给 null 时只在内存里记。读写都不抛：读不了按缺省；写不进（可信存储不可用、写满）
 * 这一次照样生效，只是下次启动不记得。
 */
export interface LocalPref<T> {
  /** 当前值，只读；`load` 之前是 `fallback`。 */
  readonly atom: Atom<T>;
  /** 读存档，不动 store。 */
  read(storage?: PrefStorage | null): T;
  /** 只写存档，不动 store：值由调用方自己的状态持有时用。 */
  write(value: T, storage?: PrefStorage | null): void;
  /** 读存档写进 store，答读到的值。再调会拿存档盖掉 store 里这次启动改过、却没写进存档的值。 */
  load(store: Store, storage?: PrefStorage | null): T;
  /** 改值并写回，立即生效；与此刻的值相同（`Object.is`）就不写。答改没改。 */
  set(store: Store, value: T, storage?: PrefStorage | null): boolean;
}

export function defineLocalPref<T>(spec: LocalPrefSpec<T>): LocalPref<T> {
  const { key, fallback, parse, format } = spec;
  const current = atom<T>(fallback);

  function persist(storage: PrefStorage, value: T): void {
    try {
      storage.setItem(key, format(value));
    } catch {
      // 写不进只影响下次启动，这一次照样生效。
    }
  }

  function read(storage: PrefStorage | null = browserStorage()): T {
    if (!storage) return fallback;
    try {
      const raw = storage.getItem(key);
      return raw === null ? fallback : (parse(raw) ?? fallback);
    } catch {
      return fallback;
    }
  }

  return {
    atom: atom((get) => get(current)),
    read,
    write(value, storage = browserStorage()) {
      if (storage) persist(storage, value);
    },
    load(store, storage) {
      const value = read(storage);
      store.set(current, value);
      return value;
    },
    set(store, value, storage = browserStorage()) {
      if (Object.is(store.get(current), value)) return false;
      store.set(current, value);
      if (storage) persist(storage, value);
      return true;
    },
  };
}
