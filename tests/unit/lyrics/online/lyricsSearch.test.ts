import type { LyricLine } from '@applemusic-like-lyrics/core';
import { describe, expect, it } from 'vitest';
import {
  pickLyrics,
  searchOnline,
  searchSource,
  type FoundLyrics,
} from '../../../../src/lyrics/online/lyricsSearch.ts';
import type {
  LyricsCandidate,
  LyricsFetchResult,
  LyricsQuery,
  LyricsSource,
  LyricsSourceId,
} from '../../../../src/lyrics/online/lyricsSource.ts';
import type { LyricsContent } from '../../../../src/lyrics/lyricsText.ts';

const query: LyricsQuery = {
  title: '晴天',
  artists: ['周杰伦'],
  album: '叶惠美',
  albumArtists: [],
  durationMs: 269_000,
};

const line = (words: string[], translatedLyric = ''): LyricLine => ({
  words: words.map((word, index) => ({ startTime: index * 100, endTime: index * 100 + 100, word })),
  translatedLyric,
  romanLyric: '',
  startTime: 0,
  endTime: words.length * 100,
  isBG: false,
  isDuet: false,
});

const WORD: LyricsContent = { kind: 'synced', lines: [line(['故事', '的'])] };
const LINE: LyricsContent = { kind: 'synced', lines: [line(['故事的小黄花'])] };
const LINE_TRANSLATED: LyricsContent = {
  kind: 'synced',
  lines: [line(['故事的小黄花'], 'little flower')],
};
const WORD_CENSORED: LyricsContent = { kind: 'synced', lines: [line(['f**k', 'it'])] };
const PLAIN: LyricsContent = { kind: 'plain', lines: ['故事的小黄花'] };

const candidate = (
  source: LyricsSourceId,
  ref: string,
  fields: Partial<LyricsCandidate> = {},
): LyricsCandidate => ({
  source,
  ref,
  title: '晴天',
  artists: ['周杰伦'],
  album: '叶惠美',
  durationMs: 269_000,
  ...fields,
});

/** 照脚本应答的来源：`fetched` 按 ref 给取词结果，`calls` 记下问过几次。 */
function fakeSource(
  id: LyricsSourceId,
  found: readonly LyricsCandidate[] | 'failed' | Error,
  fetched: Readonly<Record<string, LyricsFetchResult>> = {},
) {
  const calls: { search: number; fetch: string[] } = { search: 0, fetch: [] };
  const source: LyricsSource = {
    id,
    async search() {
      calls.search += 1;
      if (found instanceof Error) throw found;
      return found;
    },
    async fetch(item) {
      calls.fetch.push(item.ref);
      return fetched[item.ref] ?? 'missing';
    },
  };
  return { source, calls };
}

const found = (
  source: LyricsSourceId,
  content: LyricsContent,
  level: FoundLyrics['match']['level'] = 'perfect',
): FoundLyrics => ({
  content,
  source,
  candidate: candidate(source, source),
  match: { level, points: 22 },
});

describe('在一家里找', () => {
  it('取最像的那条；它答没有时换下一条，最多试两条', async () => {
    const { source, calls } = fakeSource(
      'netease',
      [
        candidate('netease', 'cover', { artists: ['某翻唱'] }),
        candidate('netease', 'a'),
        candidate('netease', 'b'),
        candidate('netease', 'c'),
      ],
      { c: LINE },
    );
    expect(await searchSource(source, query, 'high')).toBe('missing');
    expect(calls.fetch).toEqual(['a', 'b']);
  });

  it('候选自带全文时不再取词', async () => {
    const { source, calls } = fakeSource('lrclib', [candidate('lrclib', 'a', { content: LINE })]);
    expect(await searchSource(source, query, 'high')).toMatchObject({
      source: 'lrclib',
      content: LINE,
      match: { level: 'perfect' },
    });
    expect(calls.fetch).toEqual([]);
  });

  it('搜索失败、取词失败与抛错都答失败', async () => {
    expect(await searchSource(fakeSource('kugou', 'failed').source, query, 'high')).toBe('failed');
    const broken = fakeSource('kugou', [candidate('kugou', 'a')], { a: 'failed' });
    expect(await searchSource(broken.source, query, 'high')).toBe('failed');
    expect(await searchSource(fakeSource('kugou', new Error('x')).source, query, 'high')).toBe(
      'failed',
    );
  });
});

describe('几家都取到时', () => {
  const order: LyricsSourceId[] = ['lrclib', 'netease', 'kugou', 'ttmlDb', 'lrcmux'];

  it('逐字优先于逐行，逐行优先于纯文本', () => {
    const picked = pickLyrics(
      [found('lrclib', PLAIN), found('netease', LINE), found('kugou', WORD)],
      order,
    );
    expect(picked?.source).toBe('kugou');
  });

  it('类别顺序优先于屏蔽字数量', () => {
    expect(pickLyrics([found('kugou', WORD_CENSORED), found('netease', LINE)], order)?.source).toBe(
      'kugou',
    );
  });

  it('同步程度相同时带译文的优先；再相同按来源顺序', () => {
    expect(
      pickLyrics([found('lrclib', LINE), found('netease', LINE_TRANSLATED)], order)?.source,
    ).toBe('netease');
    expect(pickLyrics([found('netease', LINE), found('lrclib', LINE)], order)?.source).toBe(
      'lrclib',
    );
  });

  it('只在与最高档相差一档以内的里挑：差两档的逐字词不要', () => {
    expect(
      pickLyrics([found('netease', LINE, 'perfect'), found('kugou', WORD, 'veryHigh')], order)
        ?.source,
    ).toBe('kugou');
    expect(
      pickLyrics([found('netease', LINE, 'perfect'), found('kugou', WORD, 'high')], order)?.source,
    ).toBe('netease');
  });
});

describe('在几家里找', () => {
  for (const mode of ['parallel', 'sequential'] as const) {
    it(`${mode} 开始前已中止时不调用任何来源或备选`, async () => {
      const controller = new AbortController();
      controller.abort();
      const primary = fakeSource('lrclib', []);
      const backup = fakeSource('lrcmux', []);
      expect(
        await searchOnline(query, [primary.source], {
          mode,
          minimum: 'high',
          signal: controller.signal,
          fallbacks: [backup.source],
        }),
      ).toBeNull();
      expect([primary.calls.search, backup.calls.search]).toEqual([0, 0]);
    });

    it(`${mode} 搜索结束前中止时不下载候选，也不调用备选`, async () => {
      const controller = new AbortController();
      const primary = fakeSource('kugou', [], { a: WORD });
      primary.source.search = async () => {
        controller.abort();
        return [candidate('kugou', 'a')];
      };
      const backup = fakeSource('lrcmux', []);
      expect(
        await searchOnline(query, [primary.source], {
          mode,
          minimum: 'high',
          signal: controller.signal,
          fallbacks: [backup.source],
        }),
      ).toBeNull();
      expect(primary.calls.fetch).toEqual([]);
      expect(backup.calls.search).toBe(0);
    });
  }

  it('首条候选下载期间中止时，不再下载第二条', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const source: LyricsSource = {
      id: 'kugou',
      async search() {
        return [candidate('kugou', 'a'), candidate('kugou', 'b')];
      },
      async fetch(item) {
        calls.push(item.ref);
        controller.abort();
        return 'missing';
      },
    };
    expect(
      await searchOnline(query, [source], {
        mode: 'parallel',
        minimum: 'high',
        signal: controller.signal,
      }),
    ).toBeNull();
    expect(calls).toEqual(['a']);
  });

  it('中止后才到的歌词不交给调用方', async () => {
    const controller = new AbortController();
    const primary = fakeSource('netease', [candidate('netease', 'a')]);
    primary.source.fetch = async () => {
      controller.abort();
      return WORD;
    };
    expect(
      await searchOnline(query, [primary.source], {
        mode: 'parallel',
        minimum: 'high',
        signal: controller.signal,
      }),
    ).toBeNull();
  });

  it('同时问所有来源，取最好的一份', async () => {
    const lrclib = fakeSource('lrclib', [candidate('lrclib', 'a', { content: LINE })]);
    const kugou = fakeSource('kugou', [candidate('kugou', 'k')], { k: WORD });
    const result = await searchOnline(query, [lrclib.source, kugou.source], {
      mode: 'parallel',
      minimum: 'high',
    });
    expect(result).toMatchObject({ source: 'kugou', content: WORD });
  });

  it('按顺序问时，取到没有屏蔽字的逐字词就停；逐行的不算够好', async () => {
    const lrclib = fakeSource('lrclib', [candidate('lrclib', 'a', { content: LINE })]);
    const kugou = fakeSource('kugou', [candidate('kugou', 'k')], { k: WORD });
    const lrcmux = fakeSource('lrcmux', [candidate('lrcmux', 'm', { content: WORD })]);
    const result = await searchOnline(query, [lrclib.source, kugou.source, lrcmux.source], {
      mode: 'sequential',
      minimum: 'high',
    });
    expect(result).toMatchObject({ source: 'kugou' });
    expect([lrclib.calls.search, kugou.calls.search, lrcmux.calls.search]).toEqual([1, 1, 0]);
  });

  it('都没取到：全部失败答失败，有一家明确没有就答没有', async () => {
    const down = fakeSource('lrclib', 'failed').source;
    const empty = fakeSource('netease', []).source;
    expect(
      await searchOnline(query, [down, fakeSource('kugou', 'failed').source], {
        mode: 'parallel',
        minimum: 'high',
      }),
    ).toBe('failed');
    expect(await searchOnline(query, [down, empty], { mode: 'parallel', minimum: 'high' })).toBe(
      'missing',
    );
  });

  it('翻唱过不了门槛，答没有', async () => {
    const covers = fakeSource(
      'netease',
      [candidate('netease', 'cover', { artists: ['某翻唱'], album: '' })],
      { cover: WORD },
    );
    expect(await searchOnline(query, [covers.source], { mode: 'parallel', minimum: 'high' })).toBe(
      'missing',
    );
  });

  it('备选来源只在前面一份都没取到时才问，取到了也不与前面的比', async () => {
    const netease = fakeSource('netease', [candidate('netease', 'n')], { n: LINE });
    const lrcmux = fakeSource('lrcmux', [candidate('lrcmux', 'm', { content: WORD })]);
    const result = await searchOnline(query, [netease.source], {
      mode: 'parallel',
      minimum: 'high',
      fallbacks: [lrcmux.source],
    });
    expect(result).toMatchObject({ source: 'netease', content: LINE });
    expect(lrcmux.calls.search).toBe(0);

    const empty = fakeSource('netease', []);
    const backup = await searchOnline(query, [empty.source], {
      mode: 'sequential',
      minimum: 'high',
      fallbacks: [lrcmux.source],
    });
    expect(backup).toMatchObject({ source: 'lrcmux', content: WORD });
  });

  it('备选也没取到时，前后都失败才答失败', async () => {
    const down = () => fakeSource('lrclib', 'failed').source;
    const options = { mode: 'parallel', minimum: 'high' } as const;
    expect(
      await searchOnline(query, [down()], {
        ...options,
        fallbacks: [fakeSource('lrcmux', 'failed').source],
      }),
    ).toBe('failed');
    expect(
      await searchOnline(query, [down()], {
        ...options,
        fallbacks: [fakeSource('lrcmux', []).source],
      }),
    ).toBe('missing');
  });

  it('中止后不再问后面的来源，答 null', async () => {
    const controller = new AbortController();
    const first: LyricsSource = {
      id: 'lrclib',
      async search() {
        controller.abort();
        return [];
      },
      async fetch() {
        return 'missing';
      },
    };
    const second = fakeSource('netease', []);
    const result = await searchOnline(query, [first, second.source], {
      mode: 'sequential',
      minimum: 'high',
      signal: controller.signal,
    });
    expect(result).toBeNull();
    expect(second.calls.search).toBe(0);
  });
});
