import { conditionKey, conditionQuery, type TrackCondition } from './trackConditions.ts';
import { EMPTY_TRACK_FILTER, sameTrackFilter, type TrackFilter } from './trackFilter.ts';
import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { togglePreset, type PresetId } from './queryPresets.ts';
import { changeQueryText, type QueryInput } from './queryInput.ts';
import {
  EMPTY_TRACK_FACETS,
  pruneTrackFacets,
  trackFacetCount,
  toggleTrackFacet,
  type TrackFacet,
  type TrackFacetOptions,
} from './trackFacets.ts';

export interface TrackFilterService {
  readonly state: Atom<TrackFilter>;
  dispose(): void;
  setText(text: string): void;
  setQuery(input: QueryInput): void;
  addCondition(condition: TrackCondition): void;
  removeCondition(key: string): void;
  togglePreset(id: PresetId): void;
  toggleFacet(facet: TrackFacet, name: string): void;
  clearFacets(): void;
  /** 去掉勾上的预设与分面，框里的字留着 */
  clearConditions(): void;
  /** 全部清掉：框里的字、预设与分面 */
  clear(): void;
  /** 后退回来时把快照里的那一份换回来 */
  restore(filter: TrackFilter): void;
  /** 分面的取值换了一份：勾选里已经不在清单上的值剔掉 */
  pruneFacets(options: TrackFacetOptions): void;
}

export function startTrackFilter(
  store: Store,
  filterAtom: PrimitiveAtom<TrackFilter> = atom(EMPTY_TRACK_FILTER),
  changed: (typing: boolean) => void = () => {},
): TrackFilterService {
  store.set(filterAtom, EMPTY_TRACK_FILTER);
  let disposed = false;
  const write = (filter: TrackFilter, typing = false) => {
    if (disposed) return;
    store.set(filterAtom, filter);
    changed(typing);
  };
  const update = (change: Partial<TrackFilter>, typing = false) =>
    write({ ...store.get(filterAtom), ...change }, typing);
  return {
    state: atom((get) => get(filterAtom)),
    dispose() {
      disposed = true;
    },
    setText(text) {
      update(changeQueryText(store.get(filterAtom), text), true);
    },
    setQuery: (input) =>
      update(
        { mode: input.mode, text: input.text, advancedText: input.advancedText },
        input.mode === store.get(filterAtom).mode,
      ),
    addCondition(condition) {
      if (conditionQuery(condition) === null) return;
      const current = store.get(filterAtom).conditions;
      const key = conditionKey(condition);
      if (!current.some((entry) => conditionKey(entry) === key))
        update({ conditions: [...current, condition] });
    },
    removeCondition(key) {
      update({
        conditions: store.get(filterAtom).conditions.filter((entry) => conditionKey(entry) !== key),
      });
    },
    togglePreset(id) {
      update({ presets: togglePreset(store.get(filterAtom).presets, id) });
    },
    toggleFacet(facet, name) {
      update({ facets: toggleTrackFacet(store.get(filterAtom).facets, facet, name) });
    },
    clearFacets() {
      if (trackFacetCount(store.get(filterAtom).facets) > 0) update({ facets: EMPTY_TRACK_FACETS });
    },
    clearConditions() {
      update({ presets: new Set(), facets: EMPTY_TRACK_FACETS, conditions: [] });
    },
    clear() {
      write(EMPTY_TRACK_FILTER);
    },
    restore(filter) {
      if (!sameTrackFilter(store.get(filterAtom), filter)) write(filter);
    },
    pruneFacets(options) {
      const current = store.get(filterAtom);
      const facets = pruneTrackFacets(current.facets, options);
      if (facets !== current.facets) update({ facets });
    },
  };
}
