import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import { presetOf, togglePreset, type PresetId } from '../../track/queryPresets.ts';
import { changeQueryText, EMPTY_QUERY_INPUT, type QueryInput } from '../../track/queryInput.ts';
import { allOf, queryWords, wordsQuery, type QueryScope } from '../../track/trackQuery.ts';
import {
  EMPTY_SONG_FACETS,
  pruneSongFacets,
  songFacetCount,
  songFacetQueries,
  toggleSongFacet,
  type SongFacet,
  type SongFacetOptions,
  type SongFacetSelection,
} from './songsFacets.ts';

/** 歌曲页此刻的筛选：框里的字、勾上的预设与分面。不落盘，离开再回来由页面快照交还。 */
export interface SongsFilter extends QueryInput {
  readonly presets: ReadonlySet<PresetId>;
  readonly facets: SongFacetSelection;
}

export const EMPTY_SONGS_FILTER: SongsFilter = {
  ...EMPTY_QUERY_INPUT,
  presets: new Set(),
  facets: EMPTY_SONG_FACETS,
};

/** 筛选拼成的那串查询，加上它从哪几样来：页头与空态的文案按它写。 */
export interface SongsQuery {
  /** 交给宿主的查询；什么都不筛时是 `ALL`。 */
  readonly query: string;
  /** 框里写的是 fb2k 查询。 */
  readonly raw: boolean;
  /** 框里按词过滤时的词，折过小写。 */
  readonly words: readonly string[];
  /** 有任何一样在筛：框里有字、勾了预设或分面。 */
  readonly filtered: boolean;
}

/** 当前模式的输入与预设、分面同时生效；另一模式的草稿不参与查询。 */
export function songsQueryOf(filter: SongsFilter, scope: QueryScope): SongsQuery {
  const raw = filter.mode === 'advanced' ? filter.advancedText.trim() : null;
  const words = raw === null ? queryWords(filter.text) : [];
  const box = raw ?? wordsQuery(words, scope);
  const presets = [...filter.presets].map((id) => presetOf(id).query);
  const parts = [box, ...presets, ...songFacetQueries(filter.facets)];
  const filtered = box !== '' || filter.presets.size > 0 || songFacetCount(filter.facets) > 0;
  return { query: allOf(parts), raw: raw !== null, words, filtered };
}

export function sameSongsFilter(a: SongsFilter, b: SongsFilter): boolean {
  const sameSet = (x: ReadonlySet<string>, y: ReadonlySet<string>) =>
    x.size === y.size && [...x].every((value) => y.has(value));
  return (
    a.text === b.text &&
    a.mode === b.mode &&
    a.advancedText === b.advancedText &&
    sameSet(a.presets, b.presets) &&
    sameSet(a.facets.genre, b.facets.genre) &&
    sameSet(a.facets.decade, b.facets.decade) &&
    sameSet(a.facets.artist, b.facets.artist)
  );
}

const filterAtom = atom<SongsFilter>(EMPTY_SONGS_FILTER);

export const songsFilterAtom: Atom<SongsFilter> = atom((get) => get(filterAtom));

export interface SongsFilterService {
  setText(text: string): void;
  setQuery(input: QueryInput): void;
  togglePreset(id: PresetId): void;
  toggleFacet(facet: SongFacet, name: string): void;
  clearFacets(): void;
  /** 去掉勾上的预设与分面，框里的字留着。 */
  clearConditions(): void;
  /** 全部清掉：框里的字、预设与分面。 */
  clear(): void;
  /** 后退回来时把快照里的那一份换回来。 */
  restore(filter: SongsFilter): void;
  /** 分面的取值换了一份：勾选里已经不在清单上的值剔掉。 */
  pruneFacets(options: SongFacetOptions): void;
}

export function startSongsFilter(store: Store): SongsFilterService {
  store.set(filterAtom, EMPTY_SONGS_FILTER);
  const update = (change: Partial<SongsFilter>) =>
    store.set(filterAtom, { ...store.get(filterAtom), ...change });
  return {
    setText(text) {
      update(changeQueryText(store.get(filterAtom), text));
    },
    setQuery: (input) =>
      update({ mode: input.mode, text: input.text, advancedText: input.advancedText }),
    togglePreset(id) {
      update({ presets: togglePreset(store.get(filterAtom).presets, id) });
    },
    toggleFacet(facet, name) {
      update({ facets: toggleSongFacet(store.get(filterAtom).facets, facet, name) });
    },
    clearFacets() {
      if (songFacetCount(store.get(filterAtom).facets) > 0) update({ facets: EMPTY_SONG_FACETS });
    },
    clearConditions() {
      update({ presets: new Set(), facets: EMPTY_SONG_FACETS });
    },
    clear() {
      store.set(filterAtom, EMPTY_SONGS_FILTER);
    },
    restore(filter) {
      if (!sameSongsFilter(store.get(filterAtom), filter)) store.set(filterAtom, filter);
    },
    pruneFacets(options) {
      const current = store.get(filterAtom);
      const facets = pruneSongFacets(current.facets, options);
      if (facets !== current.facets) update({ facets });
    },
  };
}
