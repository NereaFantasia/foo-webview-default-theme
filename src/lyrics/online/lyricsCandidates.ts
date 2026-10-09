import { compareTrack } from './lyricsMatch.ts';
import type { LyricsCandidate, LyricsQuery, LyricsSource, LyricsSourceId } from './lyricsSource.ts';

export interface LyricsCandidates {
  readonly candidates: readonly LyricsCandidate[];
  readonly failed: readonly LyricsSourceId[];
}

/** 手动搜索保留候选，不用自动取词的门槛淘汰；相同匹配程度按来源顺序排列。 */
export async function findLyricsCandidates(
  query: LyricsQuery,
  sources: readonly LyricsSource[],
  signal: AbortSignal,
): Promise<LyricsCandidates> {
  const failed: LyricsSourceId[] = [];
  async function ask(source: LyricsSource, request = query): Promise<readonly LyricsCandidate[]> {
    if (signal.aborted) return [];
    try {
      const result = await source.search(request, signal);
      if (signal.aborted) return [];
      if (result !== 'failed') return result;
    } catch {
      if (signal.aborted) return [];
    }
    failed.push(source.id);
    return [];
  }
  const byMatch = (a: LyricsCandidate, b: LyricsCandidate) =>
    compareTrack(query, b).points - compareTrack(query, a).points ||
    sources.findIndex((source) => source.id === a.source) -
      sources.findIndex((source) => source.id === b.source);
  const candidates = (
    await Promise.all(
      sources.filter((source) => source.id !== 'lrcmux').map((source) => ask(source)),
    )
  ).flat();
  const normalize = (value: string) =>
    value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const currentQuery =
    !query.keywords ||
    [
      query.title,
      [query.title, ...query.artists].join(' '),
      [query.title, query.artists.join(', ')].join(' '),
    ].some((value) => normalize(value) === normalize(query.keywords ?? ''));
  const match = [...candidates].sort(byMatch).find((item) => item.title && item.artists.length);
  // 聚合接口只收曲名和艺人；自由关键词先由直连来源解析成候选，不借当前艺人猜测另一首歌。
  const aggregateQuery: LyricsQuery | null =
    !query.keywords || (!match && currentQuery)
      ? { ...query, keywords: undefined }
      : match
        ? {
            title: match.title,
            artists: match.artists,
            album: match.album,
            albumArtists: match.albumArtists ?? [],
            durationMs: match.durationMs,
          }
        : null;
  if (aggregateQuery) {
    const more = await Promise.all(
      sources
        .filter((source) => source.id === 'lrcmux')
        .map((source) => ask(source, aggregateQuery)),
    );
    candidates.push(...more.flat());
  }
  const unique = new Map(
    candidates.map((candidate) => [`${candidate.source}:${candidate.ref}`, candidate]),
  );
  return {
    candidates: [...unique.values()].sort(byMatch),
    failed,
  };
}
