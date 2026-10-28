import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from './store.ts';

/** 偏好存储同步接口。未注入底层实现（null）时仅保留内存状态；实际由 `prefStorage.ts` 异步刷盘 */
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let pageStorage: PrefStorage | null = null;

/** 注入全局页面偏好存储实现，通常在应用装配期初始化，卸载时传入 null 复位 */
export function installPrefStorage(storage: PrefStorage | null): void {
  pageStorage = storage;
}

/** 获取当前环境注入的偏好存储实例；未就绪时返回 null。业务代码禁止直接绕过该方法访问原生 `localStorage` */
export function browserStorage(): PrefStorage | null {
  return pageStorage;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验并收窄为普通记录对象；若非对象类型或为数组/null 则安全回退为空对象 */
export function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

/** 解析 JSON 记录文本；若为空、语法错误或非普通对象均安全返回空对象 */
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
   * 偏好键名，契约规范为 `default-theme.<区域>.v<N>`
   * 已发布的键禁止重命名；结构升级时须递增版本后缀换新键，旧键保留供版本回滚读取
   */
  readonly key: string;
  /** 当存储缺失、读取异常或数据无法反序列化时的默认回退值 */
  readonly fallback: T;
  /** 原始文本解析函数；无法识别时返回 undefined 以触发默认值。复合对象应逐项校验并局部容错 */
  readonly parse: (raw: string) => T | undefined;
  /** 数据序列化格式化函数；必须与 `parse` 形成对称可逆映射 */
  readonly format: (value: T) => string;
}

/** 偏好编解码器，包含互为逆操作的 `parse` 与 `format` 函数 */
export type PrefCodec<T> = Pick<LocalPrefSpec<T>, 'parse' | 'format'>;

/** 布尔开关编解码器：映射为 `'on'` / `'off'`；其他无效输入回退为 undefined */
export const ON_OFF: PrefCodec<boolean> = {
  parse: (raw) => (raw === 'on' ? true : raw === 'off' ? false : undefined),
  format: (value) => (value ? 'on' : 'off'),
};

/** 取值表里的一项，存取值本身的文本，不是 JSON；不在表里的认不出，按缺省 */
export function choiceCodec<T extends string | number>(choices: readonly T[]): PrefCodec<T> {
  return {
    parse: (raw) => choices.find((choice) => String(choice) === raw),
    format: (value) => String(value),
  };
}

/**
 * 一项随这台机器记住的偏好，不随 profile：启动时页面的偏好存储读完之后，同步读得到，不等宿主
 * 要随 profile 记住、能等宿主就绪的偏好用 `host/configPref.ts`
 *
 * 在模块顶层用 `defineLocalPref` 定义一次，值按 store 各存一份。各方法不给 `storage` 时用页面的
 * 偏好存储，给 null 时只在内存里记。读写都不抛：读不了按缺省；写不进（可信存储不可用、写满）
 * 这一次照样生效，只是下次启动不记得
 */
export interface LocalPref<T> {
  /** 当前值，只读；`load` 之前是 `fallback` */
  readonly atom: Atom<T>;
  /** 读存档，不动 store */
  read(storage?: PrefStorage | null): T;
  /** 只写存档，不动 store：值由调用方自己的状态持有时用 */
  write(value: T, storage?: PrefStorage | null): void;
  /** 读存档写进 store，答读到的值。再调会拿存档盖掉 store 里这次启动改过、却没写进存档的值 */
  load(store: Store, storage?: PrefStorage | null): T;
  /** 改值并写回，立即生效；与此刻的值相同（`Object.is`）就不写。答改没改 */
  set(store: Store, value: T, storage?: PrefStorage | null): boolean;
}

export function defineLocalPref<T>(spec: LocalPrefSpec<T>): LocalPref<T> {
  const { key, fallback, parse, format } = spec;
  const current = atom<T>(fallback);

  function persist(storage: PrefStorage, value: T): void {
    try {
      storage.setItem(key, format(value));
    } catch {
      // 写不进只影响下次启动，这一次照样生效
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
