import { atom } from 'jotai/vanilla';
import { browserStorage, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';

export interface HomePin {
  readonly kind: 'album' | 'playlist' | 'channel';
  readonly subject: string;
  readonly name: string;
}

export const HOME_PINS_KEY = 'default-theme.home-pins.v1';
export const HOME_PIN_LIMIT = 24;

export function homePinKey(pin: Pick<HomePin, 'kind' | 'subject'>): string {
  return JSON.stringify([pin.kind, pin.subject]);
}

export function parseHomePins(raw: string | null): HomePin[] | null {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value) || value.length > HOME_PIN_LIMIT) return null;
    const pins: HomePin[] = [];
    const seen = new Set<string>();
    for (const row of value) {
      if (!row || typeof row !== 'object') return null;
      const kind: unknown = Reflect.get(row, 'kind');
      const subject: unknown = Reflect.get(row, 'subject');
      const name: unknown = Reflect.get(row, 'name');
      if (
        (kind !== 'album' && kind !== 'playlist' && kind !== 'channel') ||
        typeof subject !== 'string' ||
        !subject ||
        subject.length > 8000 ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 8000
      )
        return null;
      const pin: HomePin = { kind, subject, name };
      const key = homePinKey(pin);
      if (seen.has(key)) return null;
      seen.add(key);
      pins.push(pin);
    }
    return pins;
  } catch {
    return null;
  }
}

/** 不用 `defineLocalPref`：读不了要报出来、也不让这次的改动盖掉读不了的存档，写不进也要报。 */
export function startHomePins(store: Store, storage: PrefStorage | null = browserStorage()) {
  const state = atom({
    items: [] as readonly HomePin[],
    readFailed: false,
    saveFailed: false,
  });
  function restore() {
    try {
      const items = storage && parseHomePins(storage.getItem(HOME_PINS_KEY));
      store.set(state, { items: items ?? [], readFailed: !items, saveFailed: false });
    } catch {
      store.set(state, { ...store.get(state), readFailed: true });
    }
  }
  restore();
  return {
    state,
    retry: restore,
    toggle(pin: HomePin) {
      const previous = store.get(state);
      if (previous.readFailed || !storage) return false;
      const key = homePinKey(pin);
      const items = previous.items.some((item) => homePinKey(item) === key)
        ? previous.items.filter((item) => homePinKey(item) !== key)
        : [...previous.items, pin];
      const raw = JSON.stringify(items);
      if (!parseHomePins(raw)) return false;
      try {
        storage.setItem(HOME_PINS_KEY, raw);
        store.set(state, { items, readFailed: false, saveFailed: false });
        return true;
      } catch {
        store.set(state, { ...previous, saveFailed: true });
        return false;
      }
    },
  };
}

export type HomePinsService = ReturnType<typeof startHomePins>;
