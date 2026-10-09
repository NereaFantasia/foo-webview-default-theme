import { describe, expect, it, vi } from 'vitest';
import { findLyricsCandidates } from '../../../../src/lyrics/online/lyricsCandidates.ts';
import type {
  LyricsCandidate,
  LyricsQuery,
  LyricsSource,
} from '../../../../src/lyrics/online/lyricsSource.ts';

const QUERY: LyricsQuery = {
  title: '歌',
  artists: ['艺人'],
  album: '',
  albumArtists: [],
  durationMs: 0,
};
const CANDIDATE: LyricsCandidate = { source: 'lrclib', ref: '1', ...QUERY };

function source(
  id: LyricsSource['id'],
  result: readonly LyricsCandidate[] | 'failed',
): LyricsSource {
  return { id, search: vi.fn(async () => result), fetch: async () => 'missing' };
}

describe('手动歌词候选搜索', () => {
  it('保留低匹配候选、去重，部分来源失败不丢弃其他来源结果', async () => {
    const poor = { ...CANDIDATE, title: '另一首', artists: ['其他艺人'] };
    const fallback = source('lrcmux', []);
    const result = await findLyricsCandidates(
      QUERY,
      [source('lrclib', [poor, poor]), source('netease', 'failed'), fallback],
      new AbortController().signal,
    );
    expect(result).toEqual({ candidates: [poor], failed: ['netease'] });
    expect(fallback.search).toHaveBeenCalled();
  });

  it('合并所有启用来源的候选，提前中止不发请求', async () => {
    const fallbackCandidate = { ...CANDIDATE, source: 'lrcmux' as const };
    const sources = [source('lrclib', []), source('lrcmux', [fallbackCandidate])];
    expect(await findLyricsCandidates(QUERY, sources, new AbortController().signal)).toEqual({
      candidates: [fallbackCandidate],
      failed: [],
    });
    const cancelled = source('netease', 'failed');
    expect(await findLyricsCandidates(QUERY, [cancelled], AbortSignal.abort())).toEqual({
      candidates: [],
      failed: [],
    });
    expect(cancelled.search).not.toHaveBeenCalled();
  });
});
