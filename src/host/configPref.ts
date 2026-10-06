import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { settle } from './hostCall.ts';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';
import type { ConfigWriter } from './configWrite.ts';
import type { DataWriteFailure } from '../kit/dataWrite.ts';

/** config 收的值：JSON 能表示的那些，类型取自 SDK。 */
export type ConfigValue = Parameters<typeof fb.config.set>[1];

/** 偏好读写用到的宿主接口。 */
export interface ConfigPrefFace extends HostReadyFace {
  config: Pick<typeof fb.config, 'get' | 'set'>;
}

/**
 * 一项随 profile 记住的偏好：存在宿主 config 里，键统一以 `defaultTheme.` 开头。
 * 在模块顶层用 `defineConfigPref` 定义一次；值按 store 各存一份，改值只经 `startConfigPrefs` 给的 `set`。
 */
export interface ConfigPref<T extends ConfigValue> {
  readonly key: string;
  readonly fallback: T;
  /** 当前值，只读。 */
  readonly atom: Atom<T>;
  /**
   * 归一：不合法的值答 undefined，越界的值夹回区间。读存档与用户设值都过它，
   * 于是 config 里能存下什么与界面能设出什么是同一把尺。
   */
  readonly parse: (raw: unknown) => T | undefined;
}

/** 偏好的可写那一面，只在本模块里。收 unknown、先过 `parse`，这样各项的值类型不必对外露出。 */
interface PrefCell {
  read(store: Store): ConfigValue;
  /** 写进 store；`parse` 不收时答 false，store 不动。 */
  write(store: Store, raw: unknown): boolean;
}

const cells = new WeakMap<object, PrefCell>();

export function defineConfigPref<T extends ConfigValue>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | undefined,
): ConfigPref<T> {
  const value = atom<T>(fallback);
  const pref: ConfigPref<T> = { key, fallback, atom: atom((get) => get(value)), parse };
  cells.set(pref, {
    read: (store) => store.get(value),
    write: (store, raw) => {
      const parsed = parse(raw);
      if (parsed === undefined) return false;
      store.set(value, parsed);
      return true;
    },
  });
  return pref;
}

/** 取值必须是 `values` 里的一项。 */
export function oneOf<T extends string>(values: readonly T[]): (raw: unknown) => T | undefined {
  return (raw) => values.find((value) => value === raw);
}

export type ConfigSaveState =
  | { readonly status: 'idle' | 'pending' }
  | { readonly status: 'saved'; readonly generation: number }
  | { readonly status: 'failed'; readonly reason: DataWriteFailure };

export interface ConfigPersistence {
  readonly state: Atom<ReadonlyMap<string, ConfigSaveState>>;
  /** 只重试失败的这一项，成功答 true；不会因其他项失败而重写已经保存的值。 */
  retry(key: string): Promise<boolean>;
  /** 等调用时已经发起的写入结束；各项的成败仍从 state 读取。 */
  settled(): Promise<void>;
}

type SaveSource = Pick<ConfigPersistence, 'state' | 'retry'>;
const saveSourcesAtom = atom<readonly SaveSource[]>([]);

export interface ConfigSaveFailure {
  readonly key: string;
  readonly reason: DataWriteFailure;
  retry(): Promise<boolean>;
}

/** 只保留当前仍存活的偏好服务；重试交回原服务，界面与原服务的状态会一起更新。 */
export const configSaveFailuresAtom: Atom<readonly ConfigSaveFailure[]> = atom((get) =>
  get(saveSourcesAtom).flatMap((source) =>
    [...get(source.state)].flatMap(([key, state]) =>
      state.status === 'failed'
        ? [{ key, reason: state.reason, retry: () => source.retry(key) }]
        : [],
    ),
  ),
);

export function registerConfigPersistence(store: Store, source: SaveSource): () => void {
  store.set(saveSourcesAtom, (sources) => [...sources, source]);
  return () => store.set(saveSourcesAtom, (sources) => sources.filter((item) => item !== source));
}

export interface ConfigPrefs extends ConfigPersistence {
  /** 连上宿主、各项都读回或补写完时兑现，不会拒绝；调用方不必等它。 */
  readonly ready: Promise<void>;
  /** 立即生效，持久化成功答 true；未就绪时合并同一项的选择，失败后再设相同值也会重试。 */
  set<T extends ConfigValue>(pref: ConfigPref<T>, value: T): Promise<boolean>;
  dispose(): void;
}

interface PrefEntry {
  readonly pref: ConfigPref<ConfigValue>;
  readonly cell: PrefCell;
  revision: number;
  picked: boolean;
  loaded: boolean;
  task?: Promise<boolean>;
}

/**
 * 把一组偏好接到 store 与宿主上。三条规则：读回的值先过 `parse`，config 里的东西谁都能改；
 * 宿主就绪前用户先设过的，以用户的为准，晚到的存档不覆盖它，就绪后把它补写进 config；
 * 保存失败保留当前值，state 按键记录失败；提示和重试入口由调用方呈现。
 */
export function startConfigPrefs(
  store: Store,
  prefs: readonly ConfigPref<ConfigValue>[],
  host: ConfigPrefFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): ConfigPrefs {
  let disposed = false;
  let connected = false;
  const entries = new Map<string, PrefEntry>();
  for (const pref of prefs) {
    const cell = cells.get(pref);
    if (cell) entries.set(pref.key, { pref, cell, revision: 0, picked: false, loaded: false });
  }
  const state = atom<ReadonlyMap<string, ConfigSaveState>>(
    new Map<string, ConfigSaveState>([...entries.keys()].map((key) => [key, { status: 'idle' }])),
  );
  const tasks = new Set<Promise<boolean>>();
  const waiter = waitForHost(host);
  const lifetime = new AbortController();
  let cancelWaiting = () => {};
  const cancelled = new Promise<false>((resolve) => {
    cancelWaiting = () => resolve(false);
  });
  // 宿主的 ready 无法取消；本服务自己的等待在释放时仍须结束。
  const hostReady = Promise.race([waiter.done, cancelled]);
  void hostReady.then(() => waiter.cancel());

  function report(entry: PrefEntry, revision: number, result: ConfigSaveState): void {
    if (disposed || revision !== entry.revision) return;
    store.set(state, new Map(store.get(state)).set(entry.pref.key, result));
  }

  function persist(entry: PrefEntry): Promise<boolean> {
    const revision = ++entry.revision;
    report(entry, revision, { status: 'pending' });
    let value: ConfigValue;
    try {
      value = structuredClone(entry.cell.read(store));
    } catch {
      report(entry, revision, { status: 'failed', reason: 'write-failed' });
      return Promise.resolve(false);
    }
    async function write(): Promise<boolean> {
      try {
        if (!connected) {
          const arrived = await hostReady;
          if (disposed || revision !== entry.revision) return false;
          if (!arrived) {
            report(entry, revision, { status: 'failed', reason: 'unavailable' });
            return false;
          }
        }
        if (disposed) return false;
        const result = writer
          ? await writer.set(entry.pref.key, value, lifetime.signal)
          : { success: false as const, reason: 'unavailable' as const };
        report(
          entry,
          revision,
          result.success
            ? { status: 'saved', generation: result.value }
            : { status: 'failed', reason: result.reason },
        );
        return result.success;
      } catch {
        report(entry, revision, { status: 'failed', reason: 'write-failed' });
        return false;
      }
    }
    const task = write();
    entry.task = task;
    tasks.add(task);
    void task.then(() => tasks.delete(task));
    return task;
  }

  async function settled(): Promise<void> {
    await Promise.all([...tasks]);
  }

  async function restore(entry: PrefEntry): Promise<void> {
    if (entry.picked) return;
    const answer = await settle(() => host.config.get(entry.pref.key));
    if (disposed || entry.picked || !answer || answer.success === false) return;
    entry.loaded = !answer.found || entry.cell.write(store, answer.value);
  }

  async function connect(): Promise<void> {
    const arrived = await hostReady;
    if (disposed) return;
    connected = arrived;
    if (arrived) await Promise.all([...entries.values()].map(restore));
    await settled();
  }

  const service: ConfigPrefs = {
    ready: connect(),
    state: atom((get) => get(state)),
    settled,
    set(pref, value) {
      const entry = entries.get(pref.key);
      if (disposed || !entry || entry.pref !== pref) return Promise.resolve(false);
      const before = entry.cell.read(store);
      if (!entry.cell.write(store, value)) return Promise.resolve(false);
      entry.picked = true;
      // 滑块与滚轮到了端点还会继续报同一个值，每一下都写 config 是白发。
      if (
        Object.is(before, entry.cell.read(store)) &&
        store.get(state).get(pref.key)?.status !== 'failed' &&
        (entry.loaded || entry.task)
      )
        return entry.task ?? Promise.resolve(true);
      return persist(entry);
    },
    retry(key) {
      const entry = entries.get(key);
      if (disposed || !entry || store.get(state).get(key)?.status !== 'failed') {
        return Promise.resolve(false);
      }
      return persist(entry);
    },
    dispose() {
      disposed = true;
      unregister();
      waiter.cancel();
      cancelWaiting();
      lifetime.abort();
    },
  };
  const unregister = registerConfigPersistence(store, service);
  return service;
}
