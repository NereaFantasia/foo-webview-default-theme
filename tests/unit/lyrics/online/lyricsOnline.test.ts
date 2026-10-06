import { describe, expect, it } from 'vitest';
import { createLyricsOnline } from '../../../../src/lyrics/online/lyricsOnline.ts';
import type { LyricsPrefs } from '../../../../src/lyrics/lyricsPrefs.ts';
import type { LyricsQuery } from '../../../../src/lyrics/online/lyricsSource.ts';
import { installLyricsHttp, json, type LyricsRoutes } from '../../../fixtures/lyricsHttp.ts';

const LRCLIB = 'https://lrclib.net/api/search';
const NETEASE = 'https://music.163.com/api/search/get/web';
const NETEASE_LYRIC = 'https://music.163.com/api/song/lyric/v1';
const LRCMUX = 'https://api.lrcmux.dev/get';

const QUERY: LyricsQuery = {
  title: '歌曲',
  artists: ['艺人'],
  album: '专辑',
  albumArtists: [],
  durationMs: 120_000,
};

const ROUTES: LyricsRoutes = {
  [LRCLIB]: json([
    {
      id: 1,
      trackName: '歌曲',
      artistName: '艺人',
      albumName: '专辑',
      duration: 120,
      syncedLyrics: '[00:01]逐行词',
    },
  ]),
  [NETEASE]: json({
    code: 200,
    result: {
      songs: [
        {
          id: 2,
          name: '歌曲',
          artists: [{ name: '艺人' }],
          album: { name: '专辑' },
          duration: 120_000,
        },
      ],
    },
  }),
  [NETEASE_LYRIC]: json({
    code: 200,
    yrc: { lyric: '[1000,2000](1000,1000,0)逐字(2000,1000,0)词' },
  }),
  [LRCMUX]: json({
    track: { title: '歌曲', artist: '艺人', album: '专辑', duration: 120 },
    meta: { level: 'line' },
    lines: [{ text: '备选歌词', start: 1000, end: 3000 }],
  }),
};

describe('在线歌词来源装配', () => {
  it.each([
    ['netease', 'lrclib'],
    ['lrclib', 'netease'],
  ] as const)('按用户顺序 %s、%s 搜索，采用逐字结果', async (first, second) => {
    const http = installLyricsHttp(ROUTES);
    const search = createLyricsOnline(http.host);
    const result = await search(
      QUERY,
      { enabled: true, sources: [first, second, 'lrcmux'] },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      source: 'netease',
      content: { kind: 'synced', lines: [{ words: [{ word: '逐字' }, { word: '词' }] }] },
    });
    expect(http.requests().map(({ url }) => url.origin + url.pathname)).toStrictEqual(
      first === 'netease' ? [NETEASE, NETEASE_LYRIC] : [LRCLIB, NETEASE, NETEASE_LYRIC],
    );
  });

  it('lrcmux 即使排在前面也只作备选，主来源已取到逐行词就不问它', async () => {
    const http = installLyricsHttp(ROUTES);
    const result = await createLyricsOnline(http.host)(
      QUERY,
      { enabled: true, sources: ['lrcmux', 'lrclib'] },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ source: 'lrclib' });
    expect(http.requests().map(({ url }) => url.origin)).toStrictEqual(['https://lrclib.net']);
  });

  it('主来源没词时才问备选', async () => {
    const http = installLyricsHttp({ ...ROUTES, [LRCLIB]: json([]) });
    const result = await createLyricsOnline(http.host)(
      QUERY,
      { enabled: true, sources: ['lrcmux', 'lrclib'] },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      source: 'lrcmux',
      content: { lines: [{ words: [{ word: '备选歌词' }] }] },
    });
    expect(http.requests().map(({ url }) => url.origin + url.pathname)).toStrictEqual([
      LRCLIB,
      LRCLIB,
      LRCMUX,
    ]);
  });

  it('未启用、未选来源或预先中止时不发请求', async () => {
    const http = installLyricsHttp(ROUTES);
    const search = createLyricsOnline(http.host);
    const off: LyricsPrefs = { enabled: false, sources: ['lrclib'] };
    expect(await search(QUERY, off, new AbortController().signal)).toBeNull();
    expect(
      await search(QUERY, { enabled: true, sources: null }, new AbortController().signal),
    ).toBe('missing');
    expect(await search(QUERY, { enabled: true, sources: [] }, new AbortController().signal)).toBe(
      'missing',
    );
    const controller = new AbortController();
    controller.abort();
    expect(await search(QUERY, { ...off, enabled: true }, controller.signal)).toBeNull();
    expect(http.requests()).toStrictEqual([]);
  });
});
