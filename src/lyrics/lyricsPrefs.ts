import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import { LYRICS_SOURCE_IDS, type LyricsSourceId } from './online/lyricsSource.ts';

export const LYRICS_PRIORITY = ['local', 'word', 'line', 'plain'] as const;
export type LyricsPriority = (typeof LYRICS_PRIORITY)[number];
export const WORD_FIRST: readonly LyricsPriority[] = ['word', 'local', 'line', 'plain'];

export function parseLyricsPriority(raw: unknown): LyricsPriority[] | undefined {
  if (!Array.isArray(raw) || raw.length !== LYRICS_PRIORITY.length) return undefined;
  const order = raw.flatMap((value: unknown) => LYRICS_PRIORITY.filter((known) => known === value));
  return new Set(order).size === LYRICS_PRIORITY.length ? order : undefined;
}

const PRIORITY_PREF = defineConfigPref(
  'defaultTheme.lyrics.priority',
  [...LYRICS_PRIORITY],
  parseLyricsPriority,
);
export const LYRICS_PRIORITY_KEY = PRIORITY_PREF.key;

export interface LyricsPrefs {
  readonly order?: readonly LyricsPriority[];
  readonly enabled: boolean;
  /** null 表示尚未选择首次预设；空数组表示不使用任何来源。 */
  readonly sources: readonly LyricsSourceId[] | null;
}

const DEFAULT_PREFS = { version: 1, enabled: false, sources: null };

function parsePrefs(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  if (Reflect.get(raw, 'version') !== 1) return undefined;
  const enabled: unknown = Reflect.get(raw, 'enabled');
  const sources: unknown = Reflect.get(raw, 'sources');
  if (typeof enabled !== 'boolean' || (sources !== null && !Array.isArray(sources)))
    return undefined;
  if (
    Array.isArray(sources) &&
    !sources.every((id: unknown) => LYRICS_SOURCE_IDS.some((known) => known === id))
  )
    return undefined;
  return {
    version: 1,
    enabled,
    sources:
      sources === null
        ? null
        : [...new Set(sources.flatMap((id: unknown) => LYRICS_SOURCE_IDS.filter((s) => s === id)))],
  };
}

const ONLINE_PREF = defineConfigPref<NonNullable<ReturnType<typeof parsePrefs>>>(
  'defaultTheme.online.lyrics',
  DEFAULT_PREFS,
  parsePrefs,
);

export const LYRICS_PREFS_KEY = ONLINE_PREF.key;

export interface LyricsPrefsService {
  readonly pref: Atom<LyricsPrefs>;
  readonly ready: Promise<void>;
  readonly persistence: ConfigPersistence;
  setEnabled(enabled: boolean, locale: string): Promise<boolean>;
  setOrder(order: readonly LyricsPriority[]): Promise<boolean>;
  setSources(sources: readonly LyricsSourceId[]): Promise<boolean>;
  dispose(): void;
}

export const lyricsPrefsKey = serviceKey<LyricsPrefsService>('lyricsPrefs');

export function startLyricsPrefs(
  store: Store,
  host?: ConfigPrefFace,
  writer?: Pick<ConfigWriter, 'set'>,
): LyricsPrefsService {
  const prefs = startConfigPrefs(store, [ONLINE_PREF, PRIORITY_PREF], host, writer);
  return {
    pref: atom((get) => ({ ...get(ONLINE_PREF.atom), order: get(PRIORITY_PREF.atom) })),
    ready: prefs.ready,
    persistence: prefs,
    setEnabled(enabled, locale) {
      const current = store.get(ONLINE_PREF.atom);
      const sources: LyricsSourceId[] | null =
        current.sources ??
        (enabled
          ? locale.toLowerCase().startsWith('zh')
            ? ['netease', 'kugou', 'ttmlDb', 'lrclib', 'lrcmux']
            : ['lrclib', 'ttmlDb', 'netease', 'kugou', 'lrcmux']
          : null);
      return prefs.set(ONLINE_PREF, { version: 1, enabled, sources });
    },
    setOrder: (order) => prefs.set(PRIORITY_PREF, [...order]),
    setSources: (sources) =>
      prefs.set(ONLINE_PREF, { ...store.get(ONLINE_PREF.atom), sources: [...sources] }),
    dispose: prefs.dispose,
  };
}
