import { describe, expect, it } from 'vitest';
import {
  NO_FILTER,
  candidateKind,
  candidateSources,
  filterCandidates,
  type LyricsCandidateChoice,
  type LyricsCandidateFilter,
} from '../../../../src/lyrics/candidates/lyricsCandidateFilter.ts';
import { parseLyricsText, type LyricsContent } from '../../../../src/lyrics/lyricsText.ts';
import type { LyricsSourceId } from '../../../../src/lyrics/online/lyricsSource.ts';

function content(text: string): LyricsContent {
  const parsed = parseLyricsText(text);
  if (!parsed) throw new Error(`解析不出歌词：${text}`);
  return parsed;
}

/** 逐行：每行一个「字」 */
const LINE = content('[00:01.00]第一句\n[00:05.00]第二句');
/** 逐字：行里有不止一个字的时间 */
const WORD = content('[00:01.00]<00:01.00>第<00:01.50>一<00:02.00>句');
const PLAIN = content('第一句\n第二句');
/** 逐行带译文：译文并在对应的行上 */
function withTranslation(base: LyricsContent): LyricsContent {
  if (base.kind !== 'synced') return base;
  return {
    kind: 'synced',
    lines: base.lines.map((line, index) => ({
      ...line,
      translatedLyric: index === 0 ? '译文' : '',
    })),
  };
}

function choice(
  ref: string,
  source: LyricsSourceId,
  extra: Partial<LyricsCandidateChoice> = {},
): LyricsCandidateChoice {
  return { source, ref, title: ref, artists: [], album: '', durationMs: 0, ...extra };
}

const CANDIDATES: readonly LyricsCandidateChoice[] = [
  choice('line', 'lrclib', { content: LINE }),
  choice('word', 'netease', { content: WORD }),
  choice('plain', 'lrclib', { content: PLAIN }),
  choice('translated', 'kugou', { content: withTranslation(LINE) }),
  choice('reading', 'netease', { contentStatus: 'loading' }),
  choice('queued', 'netease'),
  choice('missing', 'kugou', { contentStatus: 'missing' }),
  choice('failed', 'lrclib', { contentStatus: 'failed' }),
];

const refs = (candidates: readonly LyricsCandidateChoice[]) =>
  candidates.map((candidate) => candidate.ref);
const filtered = (filter: Partial<LyricsCandidateFilter>) =>
  refs(filterCandidates(CANDIDATES, { ...NO_FILTER, ...filter }));

describe('candidateKind：候选卡上的同步类型', () => {
  it('有内容按内容分，没有内容按读取状态分', () => {
    expect(CANDIDATES.map(candidateKind)).toEqual([
      'line',
      'word',
      'plain',
      'line',
      'loading',
      'unknownFormat',
      'candidateMissing',
      'candidateFailed',
    ]);
  });
});

describe('candidateSources', () => {
  it('这次结果里出现过的来源，按第一次出现的先后，不重复', () => {
    expect(candidateSources(CANDIDATES)).toEqual(['lrclib', 'netease', 'kugou']);
  });
});

describe('filterCandidates', () => {
  it('不筛就原样全留', () => {
    expect(filtered({})).toEqual(refs(CANDIDATES));
  });

  it('来源只看候选自己的字段，读取中与没读到的也按来源去留', () => {
    expect(filtered({ sources: ['netease'] })).toEqual(['word', 'reading', 'queued']);
    expect(filtered({ sources: ['kugou'] })).toEqual(['translated', 'missing']);
  });

  it('格式：读到的按类型留；读取中与还没轮到读的先留着；没有可用歌词与读取失败的去掉', () => {
    expect(filtered({ formats: ['word'] })).toEqual(['word', 'reading', 'queued']);
    expect(filtered({ formats: ['line'] })).toEqual(['line', 'translated', 'reading', 'queued']);
    expect(filtered({ formats: ['plain'] })).toEqual(['plain', 'reading', 'queued']);
  });

  it('同一组里选了几项取并集', () => {
    expect(filtered({ sources: ['netease', 'kugou'] })).toEqual([
      'word',
      'translated',
      'reading',
      'queued',
      'missing',
    ]);
    expect(filtered({ formats: ['word', 'plain'] })).toEqual([
      'word',
      'plain',
      'reading',
      'queued',
    ]);
  });

  it('含译文：只留读到且带译文的，读取中与还没轮到读的先留着', () => {
    expect(filtered({ translated: true })).toEqual(['translated', 'reading', 'queued']);
  });

  it('几项同时选取交集', () => {
    expect(filtered({ sources: ['kugou'], formats: ['line'], translated: true })).toEqual([
      'translated',
    ]);
    expect(filtered({ sources: ['lrclib'], translated: true })).toEqual([]);
    expect(filtered({ sources: ['netease'], formats: ['plain'] })).toEqual(['reading', 'queued']);
  });

  it('读到之后再筛一次：先留着的按内容去留', () => {
    const read = CANDIDATES.map((candidate) =>
      candidate.ref === 'reading' ? choice('reading', 'netease', { content: PLAIN }) : candidate,
    );
    expect(refs(filterCandidates(read, { ...NO_FILTER, formats: ['word'] }))).toEqual([
      'word',
      'queued',
    ]);
  });
});
