import { conditionQuery, conditionKey, type TrackCondition } from './trackConditions.ts';
import { presetOf, type PresetId } from './queryPresets.ts';
import { EMPTY_QUERY_INPUT, type QueryInput } from './queryInput.ts';
import { allOf, queryWords, wordsQuery, type QueryScope } from './trackQuery.ts';
import {
  EMPTY_TRACK_FACETS,
  trackFacetCount,
  trackFacetQueries,
  type TrackFacetSelection,
} from './trackFacets.ts';

/** 曲目集合的综合筛选条件（搜索词、预设芯片、分面选择与自定义条件）；仅在内存或页面快照中暂存，不持久化落盘 */
export interface TrackFilter extends QueryInput {
  readonly presets: ReadonlySet<PresetId>;
  readonly facets: TrackFacetSelection;
  readonly conditions: readonly TrackCondition[];
}

export const EMPTY_TRACK_FILTER: TrackFilter = {
  ...EMPTY_QUERY_INPUT,
  presets: new Set(),
  facets: EMPTY_TRACK_FACETS,
  conditions: [],
};

/** 聚合构建的曲目查询对象及来源信息，供页头与空状态呈现对应提示文案 */
export interface TrackQuery {
  /** 下发给宿主的查询表达式；无任何筛选条件时为 ALL */
  readonly query: string;
  /** 输入框是否处于高级查询模式（原生 fb2k 查询表达式） */
  readonly raw: boolean;
  /** 普通词条搜索模式下拆分并归一化为小写的关键词列表 */
  readonly words: readonly string[];
  /** 标记是否存在任意激活的筛选条件（搜索词、预设芯片、分面或自定义条件） */
  readonly filtered: boolean;
}

/** 聚合当前模式的搜索输入、预设芯片、分面及自定义条件生成最终查询对象；非活跃模式的草稿不参与计算 */
export function trackQueryOf(filter: TrackFilter, scope: QueryScope): TrackQuery {
  const raw = filter.mode === 'advanced' ? filter.advancedText.trim() : null;
  const words = raw === null ? queryWords(filter.text) : [];
  const box = raw ?? wordsQuery(words, scope);
  const presets = [...filter.presets].map((id) => presetOf(id).query);
  const parts = [
    box,
    ...presets,
    ...trackFacetQueries(filter.facets),
    ...filter.conditions.map((condition) => conditionQuery(condition) ?? 'NOT ALL'),
  ];
  const filtered =
    box !== '' ||
    filter.presets.size > 0 ||
    trackFacetCount(filter.facets) > 0 ||
    filter.conditions.length > 0;
  return { query: allOf(parts), raw: raw !== null, words, filtered };
}

export function sameTrackFilter(a: TrackFilter, b: TrackFilter): boolean {
  const sameSet = (x: ReadonlySet<string>, y: ReadonlySet<string>) =>
    x.size === y.size && [...x].every((value) => y.has(value));
  return (
    sameSet(new Set(a.conditions.map(conditionKey)), new Set(b.conditions.map(conditionKey))) &&
    a.text === b.text &&
    a.mode === b.mode &&
    a.advancedText === b.advancedText &&
    sameSet(a.presets, b.presets) &&
    sameSet(a.facets.genre, b.facets.genre) &&
    sameSet(a.facets.decade, b.facets.decade) &&
    sameSet(a.facets.artist, b.facets.artist)
  );
}
