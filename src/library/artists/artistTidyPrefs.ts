import type { ConfigWriter } from '../../host/configWrite.ts';
import { atom, type createStore } from 'jotai/vanilla';
import { defineConfigPref, startConfigPrefs } from '../../host/configPref.ts';
import { compilationKey } from './artistNames.ts';

function names(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? [...new Set(value.filter(Boolean))]
    : undefined;
}
const COMPILATIONS = defineConfigPref('defaultTheme.artists.compilations', [], names);
const IGNORED = defineConfigPref('defaultTheme.artists.tidyIgnored', [], names);

export function startArtistTidyPrefs(
  store: ReturnType<typeof createStore>,
  writer?: Pick<ConfigWriter, 'set'>,
) {
  const prefs = startConfigPrefs(store, [COMPILATIONS, IGNORED], undefined, writer);
  return {
    persistence: prefs,
    compilations: atom<ReadonlySet<string>>(
      (get) => new Set(get(COMPILATIONS.atom).map(compilationKey)),
    ),
    ignored: atom<ReadonlySet<string>>((get) => new Set(get(IGNORED.atom))),
    mark(name: string, compilation: boolean) {
      const key = compilationKey(name);
      const next = new Set(store.get(COMPILATIONS.atom).map(compilationKey));
      if (compilation) next.add(key);
      else next.delete(key);
      prefs.set(COMPILATIONS, [...next]);
    },
    ignore(selected: readonly string[]) {
      prefs.set(IGNORED, [...new Set([...store.get(IGNORED.atom), ...selected])]);
    },
    dispose: prefs.dispose,
  };
}
