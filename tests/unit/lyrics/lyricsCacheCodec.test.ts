import { describe, expect, it } from 'vitest';
import {
  lyricsQueryDigest,
  readFoundLyrics,
  writeFoundLyrics,
} from '../../../src/lyrics/lyricsCacheCodec.ts';
import type { FoundLyrics } from '../../../src/lyrics/online/lyricsSearch.ts';
import type { LyricsQuery } from '../../../src/lyrics/online/lyricsSource.ts';

const FOUND: FoundLyrics = {
  source: 'netease',
  content: {
    kind: 'synced',
    lines: [
      {
        words: [{ word: '春', startTime: 0, endTime: 500, romanWord: 'chun', obscene: false }],
        translatedLyric: 'spring',
        romanLyric: '',
        startTime: 0,
        endTime: 1000,
        isBG: false,
        isDuet: true,
      },
    ],
  },
  candidate: {
    source: 'netease',
    ref: '123',
    title: '曲',
    artists: ['艺'],
    album: '专',
    albumArtists: ['专艺'],
    durationMs: 120_000,
    coverUrl: 'https://example.test/a.jpg',
  },
  match: { level: 'high', points: 20.5 },
};

const QUERY: LyricsQuery = {
  title: '曲',
  artists: ['艺'],
  album: '专',
  albumArtists: [],
  durationMs: 120_000,
};
const PREFS = { sources: ['lrclib', 'netease'] as const, order: ['local', 'word'] as const };

describe('歌词缓存的存取格式', () => {
  it('经 JSON 往返后原样读回，候选里的正文不重复写', () => {
    const withContent: FoundLyrics = {
      ...FOUND,
      candidate: { ...FOUND.candidate, content: { kind: 'plain', lines: ['重复的正文'] } },
    };
    const text = writeFoundLyrics(withContent);
    expect(text).not.toContain('重复的正文');
    expect(readFoundLyrics(text)).toEqual(FOUND);
  });

  it('候选没有专辑艺人与封面时也能读回', () => {
    const found: FoundLyrics = {
      ...FOUND,
      candidate: {
        source: 'netease',
        ref: '123',
        title: '曲',
        artists: ['艺'],
        album: '专',
        durationMs: 120_000,
      },
    };
    expect(readFoundLyrics(writeFoundLyrics(found))).toEqual(found);
  });

  it('任何一项不合格整条不收：来源、候选、匹配、正文', () => {
    const good = JSON.parse(writeFoundLyrics(FOUND)) as Record<string, unknown>;
    const bad = (patch: Record<string, unknown>) =>
      readFoundLyrics(JSON.stringify({ ...good, ...patch }));
    expect(bad({ source: 'file' })).toBeNull();
    expect(bad({ source: 'nowhere' })).toBeNull();
    expect(bad({ candidate: { ...FOUND.candidate, ref: 1 } })).toBeNull();
    expect(bad({ candidate: null })).toBeNull();
    expect(bad({ match: { level: 'perfect-ish', points: 1 } })).toBeNull();
    expect(bad({ match: { level: 'high', points: 'many' } })).toBeNull();
    expect(bad({ content: { kind: 'synced', lines: [{ words: 'x' }] } })).toBeNull();
    expect(readFoundLyrics('not json')).toBeNull();
    expect(readFoundLyrics('[]')).toBeNull();
  });
});

describe('歌词缓存键', () => {
  it('是 64 位十六进制，同样的输入同样的键', async () => {
    const key = await lyricsQueryDigest(QUERY, PREFS);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await lyricsQueryDigest({ ...QUERY }, { ...PREFS })).toBe(key);
  });

  it('曲目、来源或优先级任何一项变了就是另一个键', async () => {
    const key = await lyricsQueryDigest(QUERY, PREFS);
    const others = await Promise.all([
      lyricsQueryDigest({ ...QUERY, title: '另一首' }, PREFS),
      lyricsQueryDigest({ ...QUERY, artists: ['艺', '二'] }, PREFS),
      lyricsQueryDigest({ ...QUERY, durationMs: 1 }, PREFS),
      lyricsQueryDigest({ ...QUERY, neteaseId: '9' }, PREFS),
      lyricsQueryDigest(QUERY, { ...PREFS, sources: ['netease', 'lrclib'] }),
      lyricsQueryDigest(QUERY, { ...PREFS, order: ['word', 'local'] }),
    ]);
    expect(new Set([key, ...others]).size).toBe(7);
  });

  it('没选来源与没排优先级时也算得出键', async () => {
    expect(await lyricsQueryDigest(QUERY, { sources: null })).toMatch(/^[0-9a-f]{64}$/);
  });
});
