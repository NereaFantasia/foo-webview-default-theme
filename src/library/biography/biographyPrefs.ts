import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import {
  BIOGRAPHY_LANGUAGES,
  biographyArtist,
  lastfmArtistFromUrl,
  type BiographyIdentity,
  type BiographyLanguagePreference,
} from './biographyModel.ts';
import { isMbid } from './identity/musicbrainzArtist.ts';

export const BIOGRAPHY_PREFS_KEY = 'defaultTheme.online.biography';

export interface BiographyPrefs {
  readonly enabled: boolean;
  readonly language: BiographyLanguagePreference;
  readonly identities: readonly BiographyIdentity[];
  readonly loaded: boolean;
  readonly busy: boolean;
  readonly failed: boolean;
}

export interface BiographyPrefsHost extends HostReadyFace {
  readonly config: Pick<typeof fb.config, 'get'>;
}

export interface BiographyPrefsService {
  readonly state: Atom<BiographyPrefs>;
  readonly ready: Promise<void>;
  setEnabled(enabled: boolean): void;
  setLanguage(language: BiographyLanguagePreference): void;
  confirm(artist: string, url: string, mbid?: string): boolean;
  forget(artist: string): void;
  retry(): Promise<void>;
  dispose(): void;
}

export function readBiographyPrefs(
  value: unknown,
): Pick<BiographyPrefs, 'enabled' | 'identities' | 'language'> {
  const empty = { enabled: false, identities: [], language: 'auto' as const };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return empty;
  if (Reflect.get(value, 'version') !== 1) return empty;
  const raw: unknown = Reflect.get(value, 'identities');
  const identities = new Map<string, BiographyIdentity>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const artist: unknown = Reflect.get(item, 'artist');
      const sourceArtist: unknown = Reflect.get(item, 'sourceArtist');
      if (typeof artist !== 'string' || typeof sourceArtist !== 'string') continue;
      const name = biographyArtist(artist);
      const source = biographyArtist(sourceArtist);
      const mbid: unknown = Reflect.get(item, 'mbid');
      if (name && source)
        identities.set(name, {
          artist: name,
          sourceArtist: source,
          ...(isMbid(mbid) ? { mbid } : {}),
        });
    }
  }
  return {
    enabled: Reflect.get(value, 'enabled') === true,
    identities: [...identities.values()],
    language: BIOGRAPHY_LANGUAGES.find((item) => item === Reflect.get(value, 'language')) ?? 'auto',
  };
}

/** 写入经公共写入助手；没有传入 `writer` 时每次保存都按失败处理，不绕过写锁直接写宿主。 */
export function startBiographyPrefs(
  store: ReturnType<typeof createStore>,
  host: BiographyPrefsHost = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): BiographyPrefsService {
  const state = atom<BiographyPrefs>({
    enabled: false,
    language: 'auto',
    identities: [],
    loaded: false,
    busy: false,
    failed: false,
  });
  let disposed = false;
  let changed = 0;
  let saved = 0;
  let reading = 0;
  let writing: Promise<void> | null = null;
  let waiter = waitForHost(host);
  const lifetime = new AbortController();

  async function persist(): Promise<void> {
    if (writing) return writing;
    if (disposed || !store.get(state).loaded || changed === saved) return;
    let attempted = 0;
    writing = (async () => {
      while (!disposed && saved !== changed) {
        const mine = changed;
        attempted = mine;
        const { enabled, identities, language } = store.get(state);
        store.set(state, { ...store.get(state), busy: true, failed: false });
        const result = writer
          ? await writer.set(
              BIOGRAPHY_PREFS_KEY,
              {
                version: 1,
                enabled,
                language,
                identities: identities.map((identity) => ({ ...identity })),
              },
              lifetime.signal,
            )
          : null;
        if (disposed) return;
        const ok = result?.success === true;
        if (ok) saved = mine;
        if (mine === changed) store.set(state, { ...store.get(state), busy: false, failed: !ok });
        if (!ok && mine === changed) return;
      }
    })();
    try {
      await writing;
    } finally {
      writing = null;
      if (!disposed && changed !== saved && changed !== attempted) void persist();
    }
  }

  function update(
    change: Partial<Pick<BiographyPrefs, 'enabled' | 'identities' | 'language'>>,
  ): void {
    if (disposed || !store.get(state).loaded) return;
    changed += 1;
    store.set(state, { ...store.get(state), ...change });
    void persist();
  }

  async function hydrate(): Promise<void> {
    const mine = ++reading;
    const waiting = waiter;
    const arrived = await waiting.done;
    waiting.cancel();
    if (disposed || reading !== mine) return;
    const answer = arrived ? await settle(() => host.config.get(BIOGRAPHY_PREFS_KEY)) : null;
    if (disposed || reading !== mine) return;
    if (!answer || answer.success === false) {
      store.set(state, { ...store.get(state), failed: true });
      return;
    }
    store.set(state, {
      ...readBiographyPrefs(answer.found ? answer.value : null),
      loaded: true,
      busy: false,
      failed: false,
    });
  }

  return {
    state,
    ready: hydrate(),
    setEnabled: (enabled) => {
      if (store.get(state).enabled !== enabled) update({ enabled });
    },
    setLanguage: (language) => {
      if (store.get(state).language !== language) update({ language });
    },
    confirm(artist, url, mbid) {
      const name = biographyArtist(artist);
      const sourceArtist = lastfmArtistFromUrl(url);
      if (!name || !sourceArtist || disposed || !store.get(state).loaded) return false;
      update({
        identities: [
          ...store.get(state).identities.filter((item) => item.artist !== name),
          { artist: name, sourceArtist, ...(isMbid(mbid) ? { mbid } : {}) },
        ],
      });
      return true;
    },
    forget: (artist) =>
      update({
        identities: store.get(state).identities.filter((item) => item.artist !== artist),
      }),
    retry() {
      if (disposed) return Promise.resolve();
      if (store.get(state).loaded) return persist();
      waiter.cancel();
      waiter = waitForHost(host);
      return hydrate();
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      lifetime.abort();
    },
  };
}
