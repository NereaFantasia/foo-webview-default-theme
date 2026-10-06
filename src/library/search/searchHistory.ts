import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';

export const SEARCH_HISTORY_KEY = 'defaultTheme.searchHistory';
export const SEARCH_HISTORY_LIMIT = 10;

export interface SearchHistoryState {
  readonly items: readonly string[];
  readonly failed: boolean;
}

export interface SearchHistoryFace extends HostReadyFace {
  readonly config: Pick<typeof fb.config, 'get'>;
}

export interface SearchHistoryService {
  readonly state: Atom<SearchHistoryState>;
  readonly ready: Promise<void>;
  remember(text: string): void;
  remove(text: string): void;
  clear(): void;
  retry(): Promise<void>;
  dispose(): void;
}

function readItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const strings = value.filter((item): item is string => typeof item === 'string');
  return [...new Set(strings.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    SEARCH_HISTORY_LIMIT,
  );
}

/** 写入经公共写入助手；没有传入 `writer` 时每次保存都按失败处理。 */
export function startSearchHistory(
  store: Store,
  host: SearchHistoryFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): SearchHistoryService {
  const state = atom<SearchHistoryState>({ items: [], failed: false });
  let disposed = false;
  let changed = 0;
  let saved = 0;
  let connected = false;
  let loaded = false;
  let reading = 0;
  const pending: ((items: readonly string[]) => readonly string[])[] = [];
  let writing: Promise<void> | null = null;
  let waiter = waitForHost(host);
  const lifetime = new AbortController();

  async function persist(): Promise<void> {
    if (writing) return writing;
    if (disposed || !connected || !loaded || saved === changed) return;
    let attempted = 0;
    writing = (async () => {
      while (!disposed && saved !== changed) {
        const mine = changed;
        attempted = mine;
        const items = [...store.get(state).items];
        const result = writer ? await writer.set(SEARCH_HISTORY_KEY, items, lifetime.signal) : null;
        if (disposed) return;
        const ok = result?.success === true;
        if (mine === changed) store.set(state, { items, failed: !ok });
        if (!ok && mine === changed) return;
        if (ok) saved = mine;
      }
    })();
    try {
      await writing;
    } finally {
      writing = null;
      if (!disposed && changed !== saved && changed !== attempted) void persist();
    }
  }

  function update(change: (items: readonly string[]) => readonly string[]): void {
    if (disposed) return;
    if (!loaded) pending.push(change);
    changed += 1;
    const current = store.get(state);
    store.set(state, {
      items: change(current.items),
      failed: !connected || (!loaded && current.failed),
    });
    void persist();
  }

  async function hydrate(): Promise<void> {
    const mine = ++reading;
    const waiting = waiter;
    const arrived = await waiting.done;
    waiting.cancel();
    if (disposed || reading !== mine) return;
    if (!arrived) {
      if (!disposed) store.set(state, { ...store.get(state), failed: true });
      return;
    }
    connected = true;
    if (loaded) return persist();
    const answer = await settle(() => host.config.get(SEARCH_HISTORY_KEY));
    if (disposed || reading !== mine) return;
    if (!answer || answer.success === false) {
      store.set(state, { ...store.get(state), failed: true });
      return;
    }
    // 初读期间的增加、删除与清空按顺序重放：增加保留旧词，删除和清空不会被旧存档撤销。
    let items: readonly string[] = answer.found ? readItems(answer.value) : [];
    for (const change of pending) items = change(items);
    pending.length = 0;
    loaded = true;
    store.set(state, { items, failed: false });
    await persist();
  }

  return {
    state,
    ready: hydrate(),
    remember(text) {
      const value = text.trim();
      if (value)
        update((items) =>
          [value, ...items.filter((item) => item !== value)].slice(0, SEARCH_HISTORY_LIMIT),
        );
    },
    remove: (text) => update((items) => items.filter((item) => item !== text)),
    clear: () => update(() => []),
    async retry() {
      if (disposed) return;
      if (!host.isAvailable()) connected = false;
      if (!connected) {
        waiter.cancel();
        waiter = waitForHost(host);
        return hydrate();
      }
      return loaded ? persist() : hydrate();
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      lifetime.abort();
    },
  };
}
