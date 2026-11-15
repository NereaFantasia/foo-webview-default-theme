import { atom } from 'jotai/vanilla';
import { defineConfigPref, startConfigPrefs } from '../../host/configPref.ts';
import type { ConfigWriter } from '../../host/configWrite.ts';
import type { Store } from '../../kit/store.ts';

function names(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? [...new Set(value.filter(Boolean))]
    : undefined;
}
const IGNORED = defineConfigPref('defaultTheme.genres.tidyIgnored', [], names);

export function startGenresTidyPrefs(store: Store, writer?: Pick<ConfigWriter, 'set'>) {
  const prefs = startConfigPrefs(store, [IGNORED], undefined, writer);
  return {
    persistence: prefs,
    /** 点过「忽略」的流派名，按标签原文 */
    ignored: atom<ReadonlySet<string>>((get) => new Set(get(IGNORED.atom))),
    ignore(keys: readonly string[]): void {
      void prefs.set(IGNORED, [...new Set([...store.get(IGNORED.atom), ...keys])]);
    },
    dispose: prefs.dispose,
  };
}
export type GenresTidyPrefsService = ReturnType<typeof startGenresTidyPrefs>;
