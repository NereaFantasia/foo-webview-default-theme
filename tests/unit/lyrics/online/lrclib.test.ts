import { describe, expect, it } from 'vitest';
import { createLrclibSource } from '../../../../src/lyrics/online/lrclib.ts';
import type { LyricsQuery } from '../../../../src/lyrics/online/lyricsSource.ts';
import { installLyricsHttp, json } from '../../../fixtures/lyricsHttp.ts';

const SEARCH = 'https://lrclib.net/api/search';

const query: LyricsQuery = {
  title: '晴天',
  artists: ['周杰伦'],
  album: '叶惠美',
  albumArtists: [],
  durationMs: 269_000,
};

const row = (fields: Record<string, unknown> = {}) => ({
  id: 7,
  trackName: '晴天',
  artistName: '周杰伦',
  albumName: '叶惠美',
  duration: 269.5,
  instrumental: false,
  plainLyrics: '故事的小黄花',
  syncedLyrics: '[00:29.36]故事的小黄花',
  ...fields,
});

describe('LRCLIB 来源', () => {
  it('单框关键词走全文搜索，不把关键词误作曲名过滤', async () => {
    const http = installLyricsHttp({ [SEARCH]: json([row()]) });
    const found = await createLrclibSource(http.host).search({ ...query, keywords: '周杰伦 晴天' });
    expect(found).toMatchObject([{ title: '晴天', artists: ['周杰伦'] }]);
    expect(Object.fromEntries(http.requests()[0]?.url.searchParams ?? [])).toEqual({
      q: '周杰伦 晴天',
    });
  });
  it('按曲名加艺人搜，带写明应用的 UA，不带专辑；候选带全文、时长换成毫秒、艺人栏拆开', async () => {
    const http = installLyricsHttp({
      [SEARCH]: json([row(), row({ id: 9, artistName: '周杰伦 & 杨瑞代' })]),
    });
    const found = await createLrclibSource(http.host).search(query);
    const [request] = http.requests();
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      track_name: '晴天',
      artist_name: '周杰伦',
    });
    expect(String(request?.header('User-Agent'))).toMatch(/^foo-webview-default-theme\//);
    expect(found).toMatchObject([
      {
        source: 'lrclib',
        ref: '7',
        title: '晴天',
        artists: ['周杰伦'],
        album: '叶惠美',
        durationMs: 269_500,
        content: { kind: 'synced' },
      },
      { ref: '9', artists: ['周杰伦', '杨瑞代'] },
    ]);
  });

  it('没有同步词时退到纯文本；标成纯音乐的不带词，取词答没有', async () => {
    const http = installLyricsHttp({
      [SEARCH]: json([row({ syncedLyrics: null }), row({ id: 8, instrumental: true })]),
    });
    const source = createLrclibSource(http.host);
    const found = await source.search(query);
    const [plain, instrumental] = found === 'failed' ? [] : found;
    if (!plain || !instrumental) throw new Error('候选少了');
    expect(plain.content).toEqual({ kind: 'plain', lines: ['故事的小黄花'] });
    expect(instrumental.content).toBeUndefined();
    expect(await source.fetch(instrumental)).toBe('missing');
  });

  it('按艺人搜不到时只按曲名再搜一次', async () => {
    const http = installLyricsHttp({
      [SEARCH]: (url) => json(url.searchParams.has('artist_name') ? [] : [row()]),
    });
    const found = await createLrclibSource(http.host).search(query);
    expect(found).toHaveLength(1);
    expect(http.requests().map((request) => request.url.searchParams.has('artist_name'))).toEqual([
      true,
      false,
    ]);
  });

  it('错误码与不是数组的应答答失败', async () => {
    const down = installLyricsHttp({ [SEARCH]: { status: 503, body: '' } });
    expect(await createLrclibSource(down.host).search(query)).toBe('failed');
    const odd = installLyricsHttp({ [SEARCH]: json({ code: 400 }) });
    expect(await createLrclibSource(odd.host).search(query)).toBe('failed');
  });
});
