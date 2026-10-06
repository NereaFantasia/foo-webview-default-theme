import { compareTrack } from './lyricsMatch.ts';
import type { LyricsCandidate, LyricsQuery, LyricsSource, LyricsSourceId } from './lyricsSource.ts';

export interface LyricsCandidates {
  readonly candidates: readonly LyricsCandidate[];
  readonly failed: readonly LyricsSourceId[];
}

/** 手动搜索保留候选，不用自动取词的门槛淘汰；备选来源只在主来源没有候选时查询。 */
export async function findLyricsCandidates(
  query: LyricsQuery,
  sources: readonly LyricsSource[],
  signal: AbortSignal,
): Promise<LyricsCandidates> {
  const failed: LyricsSourceId[] = [];
  async function ask(source: LyricsSource): Promise<readonly LyricsCandidate[]> {
    if (signal.aborted) return [];
    try {
      const result = await source.search(query, signal);
      if (signal.aborted) return [];
      if (result !== 'failed') return result;
    } catch {
      if (signal.aborted) return [];
    }
    failed.push(source.id);
    return [];
  }
  let candidates = (await Promise.all(sources.filter((s) => s.id !== 'lrcmux').map(ask))).flat();
  if (!signal.aborted && candidates.length === 0)
    candidates = (await Promise.all(sources.filter((s) => s.id === 'lrcmux').map(ask))).flat();
  const unique = new Map(
    candidates.map((candidate) => [`${candidate.source}:${candidate.ref}`, candidate]),
  );
  return {
    candidates: [...unique.values()].sort(
      (a, b) => compareTrack(query, b).points - compareTrack(query, a).points,
    ),
    failed,
  };
}
