import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { normalizeHostPath } from '../../../host/hostPath.ts';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import { togglePreset, type PresetId } from '../../../track/queryPresets.ts';
import { changeQueryText, QUERY_DEBOUNCE_MS, type QueryInput } from '../../../track/queryInput.ts';
import { EMPTY_SONG_FACETS, toggleSongFacet, type SongFacet } from '../../songs/songsFacets.ts';
import { EMPTY_SONGS_FILTER, songsQueryOf, type SongsFilter } from '../../songs/songsFilter.ts';
import { foldersPrefsAtom } from '../foldersPrefs.ts';
import { foldersPreviewAtom } from './foldersPreview.ts';

export interface FoldersResultsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly invalid: boolean;
  readonly tracks: readonly LibraryTrack[];
  readonly total: number;
  readonly filtered: boolean;
  readonly answered: string | null;
}
const EMPTY: FoldersResultsState = {
  status: 'idle',
  invalid: false,
  tracks: [],
  total: 0,
  filtered: false,
  answered: null,
};
const stateAtom = atom<FoldersResultsState>(EMPTY);
const filterAtom = atom<SongsFilter>(EMPTY_SONGS_FILTER);
export const foldersResultsAtom: Atom<FoldersResultsState> = atom((get) => get(stateAtom));
export const foldersConditionsAtom: Atom<SongsFilter> = atom((get) => get(filterAtom));
export const foldersScopeTracksAtom = atom((get) => {
  const preview = get(foldersPreviewAtom);
  if (get(foldersPrefsAtom).recursive) return preview.tracks;
  const paths = new Set(
    preview.nodes.map((node) => normalizeHostPath(node.absolutePath).replace(/\\+$/, '')),
  );
  return preview.tracks.filter((track) => {
    const path = normalizeHostPath(track.absolutePath);
    return paths.has(path.slice(0, path.lastIndexOf('\\')));
  });
});
export interface FoldersResultsService {
  setText(text: string): void;
  setQuery(input: QueryInput): void;
  togglePreset(id: PresetId): void;
  toggleFacet(facet: SongFacet, name: string): void;
  clearConditions(): void;
  restore(filter: SongsFilter): void;
  flush(): void;
  dispose(): void;
}

export function startFoldersResults(
  store: Store,
  host: { library: Pick<typeof fb.library, 'search'> } = fb,
): FoldersResultsService {
  store.set(stateAtom, EMPTY);
  store.set(filterAtom, EMPTY_SONGS_FILTER);
  let disposed = false;
  let serial = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = store.get(foldersPreviewAtom);
  let preferences = store.get(foldersPrefsAtom);
  function cancel() {
    serial += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  async function load(mine: number) {
    timer = undefined;
    const tracks = store.get(foldersScopeTracksAtom);
    const query = songsQueryOf(store.get(filterAtom), store.get(foldersPrefsAtom).scope);
    const current = () => !disposed && mine === serial;
    if (!query.filtered || tracks.length === 0) {
      if (current())
        store.set(stateAtom, {
          status: 'ready',
          invalid: false,
          tracks,
          total: tracks.length,
          filtered: query.filtered,
          answered: query.query,
        });
      return;
    }
    const expected = new Set(tracks.map((track) => track.handle));
    const found = new Set<string>();
    let offset = 0;
    while (current()) {
      const answer = await settle(() =>
        host.library.search(query.query, 1000, { offset, fields: ['handle'] }),
      );
      if (!current()) return;
      if (!answer || answer.success === false) {
        store.set(stateAtom, {
          ...store.get(stateAtom),
          status: 'failed',
          invalid: answer?.code === 'INVALID_PARAMS',
        });
        return;
      }
      for (const track of answer.tracks)
        if (track.handle && expected.has(track.handle)) found.add(track.handle);
      if (!answer.hasMore || found.size === expected.size) break;
      if (!answer.tracks.length) {
        store.set(stateAtom, { ...store.get(stateAtom), status: 'failed' });
        return;
      }
      offset += answer.tracks.length;
    }
    if (current())
      store.set(stateAtom, {
        status: 'ready',
        invalid: false,
        tracks: tracks.filter((track) => found.has(track.handle)),
        total: tracks.length,
        filtered: true,
        answered: query.query,
      });
  }
  function schedule(delay = 0, clear = false) {
    cancel();
    if (disposed) return;
    if (store.get(foldersPreviewAtom).status !== 'ready') {
      store.set(stateAtom, EMPTY);
      return;
    }
    store.set(stateAtom, {
      ...(clear ? EMPTY : store.get(stateAtom)),
      status: 'loading',
      invalid: false,
    });
    const mine = serial;
    timer = setTimeout(() => void load(mine), delay);
  }
  const offPreview = store.sub(foldersPreviewAtom, () => {
    const next = store.get(foldersPreviewAtom);
    const changed = next !== previous;
    previous = next;
    if (changed) schedule(0, true);
  });
  const offPrefs = store.sub(foldersPrefsAtom, () => {
    const next = store.get(foldersPrefsAtom);
    const changed = next.scope !== preferences.scope || next.recursive !== preferences.recursive;
    preferences = next;
    if (changed) schedule(0, true);
  });
  function change(patch: Partial<SongsFilter>, delay = 0) {
    if (disposed) return;
    store.set(filterAtom, { ...store.get(filterAtom), ...patch });
    schedule(delay);
  }
  schedule();
  return {
    setText: (text) => change(changeQueryText(store.get(filterAtom), text), QUERY_DEBOUNCE_MS),
    setQuery: (input) =>
      change(
        { mode: input.mode, text: input.text, advancedText: input.advancedText },
        input.mode === store.get(filterAtom).mode ? QUERY_DEBOUNCE_MS : 0,
      ),
    togglePreset: (id) => change({ presets: togglePreset(store.get(filterAtom).presets, id) }),
    toggleFacet: (facet, name) =>
      change({ facets: toggleSongFacet(store.get(filterAtom).facets, facet, name) }),
    clearConditions: () => change({ presets: new Set(), facets: EMPTY_SONG_FACETS }),
    restore: (filter) => change(filter),
    flush: () => schedule(),
    dispose() {
      disposed = true;
      cancel();
      offPreview();
      offPrefs();
    },
  };
}
