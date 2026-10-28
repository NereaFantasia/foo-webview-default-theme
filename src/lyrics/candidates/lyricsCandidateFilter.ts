import type { LyricsChoiceState } from '../lyricsSearchSession.ts';
import { isWordLevel } from '../lyricsText.ts';
import type { LyricsSourceId } from '../online/lyricsSource.ts';

/**
 * 歌词检索结果客户端内存筛选逻辑
 *
 * 仅对当前已返回的候选集合进行纯客户端过滤，不发起额外网络请求；
 * 候选内容异步分批加载，内容相关的过滤需兼容未就绪状态
 */

export type LyricsCandidateChoice = LyricsChoiceState['candidates'][number];

/** 候选卡片同步类型分类标识（对齐多语言文案键后缀） */
export type LyricsCandidateKind =
  'loading' | 'candidateMissing' | 'candidateFailed' | 'unknownFormat' | 'word' | 'line' | 'plain';

export function candidateKind(candidate: LyricsCandidateChoice): LyricsCandidateKind {
  if (!candidate.content) {
    return candidate.contentStatus === 'loading'
      ? 'loading'
      : candidate.contentStatus === 'missing'
        ? 'candidateMissing'
        : candidate.contentStatus === 'failed'
          ? 'candidateFailed'
          : 'unknownFormat';
  }
  if (isWordLevel(candidate.content)) return 'word';
  return candidate.content.kind === 'synced' ? 'line' : 'plain';
}

export function candidateHasTranslation(candidate: LyricsCandidateChoice): boolean {
  return (
    candidate.content?.kind === 'synced' &&
    candidate.content.lines.some((line) => line.translatedLyric.trim())
  );
}

export const FILTER_FORMATS = ['word', 'line', 'plain'] as const;
export type LyricsFilterFormat = (typeof FILTER_FORMATS)[number];

/** 来源与格式各是一组可多选的条件，空组表示不按它筛 */
export interface LyricsCandidateFilter {
  readonly sources: readonly LyricsSourceId[];
  readonly formats: readonly LyricsFilterFormat[];
  readonly translated: boolean;
}

export const NO_FILTER: LyricsCandidateFilter = { sources: [], formats: [], translated: false };

/** 这次结果里出现过的来源，按第一次出现的先后 */
export function candidateSources(
  candidates: readonly LyricsCandidateChoice[],
): readonly LyricsSourceId[] {
  return [...new Set(candidates.map((candidate) => candidate.source))];
}

/**
 * 按条件留下候选。来源看候选自己的字段；格式与译文要看内容：还在读或还没轮到读的先留着，读到后再按条件去留，
 * 没有可用歌词与读取失败的在内容类筛选下去掉
 */
export function filterCandidates(
  candidates: readonly LyricsCandidateChoice[],
  filter: LyricsCandidateFilter,
): readonly LyricsCandidateChoice[] {
  const byContent = filter.formats.length > 0 || filter.translated;
  return candidates.filter((candidate) => {
    if (filter.sources.length > 0 && !filter.sources.includes(candidate.source)) return false;
    if (!byContent) return true;
    const kind = candidateKind(candidate);
    if (kind === 'loading' || kind === 'unknownFormat') return true;
    if (kind === 'candidateMissing' || kind === 'candidateFailed') return false;
    if (filter.formats.length > 0 && !filter.formats.includes(kind)) return false;
    return !filter.translated || candidateHasTranslation(candidate);
  });
}
