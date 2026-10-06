import type { MatchMedia } from '../../src/theme/mediaQuery.ts';

/** `matchMedia` 的替身：每条查询串各有一个开关，`set` 改值并通知订阅方。 */
export interface FakeMedia {
  readonly matchMedia: MatchMedia;
  set(query: string, matches: boolean): void;
  listenerCount(query: string): number;
}

export function fakeMedia(initial: Readonly<Record<string, boolean>> = {}): FakeMedia {
  const values = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<() => void>>();
  const listenersOf = (query: string) => {
    const existing = listeners.get(query);
    if (existing) return existing;
    const created = new Set<() => void>();
    listeners.set(query, created);
    return created;
  };
  return {
    matchMedia: (query) => ({
      get matches() {
        return values.get(query) ?? false;
      },
      addEventListener: (_type, listener) => listenersOf(query).add(listener),
      removeEventListener: (_type, listener) => listenersOf(query).delete(listener),
    }),
    set(query, matches) {
      values.set(query, matches);
      for (const listener of listenersOf(query)) listener();
    },
    listenerCount: (query) => listenersOf(query).size,
  };
}
