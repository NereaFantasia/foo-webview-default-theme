import { LYRICS_PRIORITY, type LyricsPriority } from '../lyricsPrefs.ts';
import { isWordLevel, type LyricsContent } from '../lyricsText.ts';
import { levelRank, rankCandidates, type MatchLevel, type MatchResult } from './lyricsMatch.ts';
import type { LyricsCandidate, LyricsQuery, LyricsSource, LyricsSourceId } from './lyricsSource.ts';

/** 一家取到的词。 */
export interface FoundLyrics {
  readonly content: LyricsContent;
  readonly source: LyricsSourceId;
  readonly candidate: LyricsCandidate;
  readonly match: MatchResult;
}

export type SourceOutcome = FoundLyrics | 'missing' | 'failed';

/** 同一家里最多试几条候选：前一条取词答「没有」时换下一条。 */
const FETCH_ATTEMPTS = 2;

/** 在一家里找：搜索、按档排候选、依次取词。中止答 null，其他抛错按失败处理。 */
export async function searchSource(
  source: LyricsSource,
  query: LyricsQuery,
  minimum: MatchLevel,
  signal?: AbortSignal,
): Promise<SourceOutcome | null> {
  if (signal?.aborted) return null;
  try {
    const found = await source.search(query, signal);
    if (signal?.aborted) return null;
    if (found === 'failed') return 'failed';
    let failed = false;
    for (const { candidate, match } of rankCandidates(query, found, minimum).slice(
      0,
      FETCH_ATTEMPTS,
    )) {
      if (signal?.aborted) return null;
      const content = candidate.content ?? (await source.fetch(candidate, signal));
      if (signal?.aborted) return null;
      if (content === 'failed') failed = true;
      else if (content !== 'missing') return { content, source: source.id, candidate, match };
    }
    return failed ? 'failed' : 'missing';
  } catch {
    return signal?.aborted ? null : 'failed';
  }
}

const lineTexts = (content: LyricsContent): string[] =>
  content.kind === 'plain'
    ? [...content.lines]
    : content.lines.map((line) => line.words.map((word) => word.word).join(''));

/** 被打成星号的字数；酷狗等会把粗口换成 `*`。 */
const censoredCount = (content: LyricsContent) =>
  lineTexts(content).reduce((sum, text) => sum + (text.match(/\*/g)?.length ?? 0), 0);

export const lyricsCategory = (content: LyricsContent): Exclude<LyricsPriority, 'local'> =>
  isWordLevel(content) ? 'word' : content.kind === 'synced' ? 'line' : 'plain';

const hasTranslation = (content: LyricsContent) =>
  content.kind === 'synced' && content.lines.some((line) => line.translatedLyric);

/**
 * 几家都取到时只留与最高匹配档相差不超过一档的，再按类别偏好选取。
 * 同类别优先屏蔽字少、带译文的内容；仍相同时按来源顺序。
 */
export function pickLyrics(
  found: readonly FoundLyrics[],
  order: readonly LyricsSourceId[],
  priority: readonly LyricsPriority[] = LYRICS_PRIORITY,
): FoundLyrics | null {
  if (found.length === 0) return null;
  const top = Math.min(...found.map((item) => levelRank(item.match.level)));
  const position = (id: LyricsSourceId) => {
    const index = order.indexOf(id);
    return index < 0 ? order.length : index;
  };
  return (
    found
      .filter((item) => levelRank(item.match.level) <= top + 1)
      .sort(
        (a, b) =>
          priority.indexOf(lyricsCategory(a.content)) -
            priority.indexOf(lyricsCategory(b.content)) ||
          censoredCount(a.content) - censoredCount(b.content) ||
          Number(hasTranslation(b.content)) - Number(hasTranslation(a.content)) ||
          position(a.source) - position(b.source),
      )[0] ?? null
  );
}

/** 按顺序找时，取到首选在线类别且没有屏蔽字，就不再问后面的来源。 */
const satisfies = (item: FoundLyrics, priority: readonly LyricsPriority[]) =>
  lyricsCategory(item.content) === priority.find((value) => value !== 'local') &&
  censoredCount(item.content) === 0;

export interface OnlineSearchOptions {
  readonly priority?: readonly LyricsPriority[];
  /** `parallel` 同时问所有来源，取最好的；`sequential` 按来源顺序逐个问，够好就停。 */
  readonly mode: 'parallel' | 'sequential';
  readonly minimum: MatchLevel;
  /**
   * 备选来源，同样按顺序排：前面的来源一份都没取到时才问它们，取到了也不与前面的比。
   * 用于自己再去问别家、只回一份的聚合服务，它交回的曲目信息不是出词那家的。
   */
  readonly fallbacks?: readonly LyricsSource[];
  /** 换曲时中止：已发出的请求收不回，但不再发新的请求，结果答 null。 */
  readonly signal?: AbortSignal;
}

/** 按 `mode` 问一组来源，中止时答 null。 */
async function askSources(
  query: LyricsQuery,
  sources: readonly LyricsSource[],
  { mode, minimum, signal, priority = LYRICS_PRIORITY }: OnlineSearchOptions,
): Promise<SourceOutcome[] | null> {
  if (signal?.aborted) return null;
  if (mode === 'parallel') {
    const outcomes = await Promise.all(
      sources.map((source) => searchSource(source, query, minimum, signal)),
    );
    return signal?.aborted ? null : outcomes.filter((outcome) => outcome !== null);
  }
  const outcomes: SourceOutcome[] = [];
  for (const source of sources) {
    if (signal?.aborted) return null;
    const outcome = await searchSource(source, query, minimum, signal);
    if (outcome === null) return null;
    outcomes.push(outcome);
    if (typeof outcome === 'object' && satisfies(outcome, priority)) break;
  }
  return signal?.aborted ? null : outcomes;
}

const bestOf = (
  outcomes: readonly SourceOutcome[],
  sources: readonly LyricsSource[],
  priority?: readonly LyricsPriority[],
) =>
  pickLyrics(
    outcomes.filter((outcome) => typeof outcome === 'object'),
    sources.map((source) => source.id),
    priority,
  );

/**
 * 在几家里找一首的词。`sources` 的顺序就是用户排的优先级。一份都没取到时：问过的来源全部失败答 `failed`，
 * 稍后可以再试；否则答 `missing`。
 */
export async function searchOnline(
  query: LyricsQuery,
  sources: readonly LyricsSource[],
  options: OnlineSearchOptions,
): Promise<FoundLyrics | 'missing' | 'failed' | null> {
  const outcomes = await askSources(query, sources, options);
  if (!outcomes) return null;
  const best = bestOf(outcomes, sources, options.priority);
  if (best) return best;
  const fallbacks = options.fallbacks ?? [];
  if (fallbacks.length > 0) {
    const more = await askSources(query, fallbacks, options);
    if (!more) return null;
    const backup = bestOf(more, fallbacks, options.priority);
    if (backup) return backup;
    outcomes.push(...more);
  }
  return outcomes.length > 0 && outcomes.every((outcome) => outcome === 'failed')
    ? 'failed'
    : 'missing';
}
