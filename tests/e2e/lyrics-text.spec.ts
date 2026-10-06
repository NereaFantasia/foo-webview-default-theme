import { expect, test } from '@playwright/test';
import { installPageHost } from '../fixtures/pageHost.ts';

const TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
  <body><div>
    <p begin="00:01.000" end="00:03.000" itunes:key="L1">
      <span begin="00:01.000" end="00:02.000">Hello </span>
      <span begin="00:02.000" end="00:03.000">world</span>
      <span ttm:role="x-translation" xml:lang="zh-CN">你好世界</span>
      <span ttm:role="x-roman">ni hao shi jie</span>
    </p>
    <p begin="00:04.000" end="00:05.000" itunes:key="L2">
      <span begin="00:04.000" end="00:05.000">Next</span>
    </p>
  </div></body>
</tt>`;

test.use({ screenshot: 'off' });

test('TTML 来源经 SDK 下载后由浏览器真实解析逐字时间、译文与音译', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const host = await installPageHost(page);
  host.answer('http.get', {
    success: true,
    status: 200,
    headers: {},
    body: TTML,
    responseType: 'text',
  });
  await page.route('**/__lyrics_probe__', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  await page.goto('/__lyrics_probe__');
  const result = await page.evaluate(async () => {
    const sourcePath = '/tests/fixtures/lyricsProbe.ts';
    const { lyricsProbeSources }: typeof import('../fixtures/lyricsProbe.ts') = await import(
      sourcePath
    );
    const source = lyricsProbeSources.find((item) => item.id === 'ttmlDb');
    if (!source) throw new Error('缺少 TTML 来源');
    return source.fetch({
      source: 'ttmlDb',
      ref: 'example.ttml',
      title: 'Example',
      artists: [],
      album: '',
      durationMs: 5000,
    });
  });
  expect(result).toMatchObject({
    kind: 'synced',
    lines: [
      {
        startTime: 1000,
        endTime: 3000,
        translatedLyric: '你好世界',
        romanLyric: 'ni hao shi jie',
        words: [
          { startTime: 1000, endTime: 2000, word: 'Hello ' },
          { startTime: 2000, endTime: 3000, word: 'world' },
        ],
      },
      { startTime: 4000, endTime: 5000, words: [{ word: 'Next' }] },
    ],
  });
  expect(host.callsTo('http.get')).toHaveLength(1);
  expect(errors).toEqual([]);
});

// 只在显式设置 LYRICS_LIVE=1 时访问外部词源，普通回归不联网。
test('实站探测五个词源的搜索、下载与解析', async ({ page }) => {
  test.skip(process.env.LYRICS_LIVE !== '1', '仅按需联网验证');
  test.setTimeout(180_000);
  const host = await installPageHost(page);
  const origins = new Set([
    'https://lrclib.net',
    'https://music.163.com',
    'https://lyrics.kugou.com',
    'https://raw.githubusercontent.com',
    'https://api.lrcmux.dev',
  ]);
  host.answer('http.get', async (params) => {
    const url = new URL(String(params['url']));
    if (!origins.has(url.origin)) throw new Error(`探测不允许访问 ${url.origin}`);
    const headers = new Headers();
    if (typeof params['headers'] === 'object' && params['headers'] !== null) {
      for (const [name, value] of Object.entries(params['headers'])) {
        if (typeof value === 'string') headers.set(name, value);
      }
    }
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
      const body = await response.text();
      console.log(JSON.stringify({ endpoint: url.origin + url.pathname, status: response.status }));
      return {
        success: true,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body,
        responseType: 'text',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({ endpoint: url.origin + url.pathname, error: message }));
      return { success: false, error: message, code: 'OPERATION_FAILED' };
    }
  });
  await page.route('**/__lyrics_probe__', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  await page.goto('/__lyrics_probe__');
  const queries = [
    { title: '江南', artists: ['林俊杰'], album: '第二天堂', durationMs: 267_000 },
    { title: 'アイドル', artists: ['YOASOBI'], album: 'アイドル', durationMs: 213_000 },
    {
      title: 'Bohemian Rhapsody',
      artists: ['Queen'],
      album: 'A Night at the Opera',
      durationMs: 354_000,
    },
  ];
  const hits = new Set<string>();
  for (const query of queries) {
    const results = await page.evaluate(async (input) => {
      const sourcePath = '/tests/fixtures/lyricsProbe.ts';
      const searchPath = '/src/lyrics/online/lyricsSearch.ts';
      const { lyricsProbeSources }: typeof import('../fixtures/lyricsProbe.ts') = await import(
        sourcePath
      );
      const { searchSource }: typeof import('../../src/lyrics/online/lyricsSearch.ts') =
        await import(searchPath);
      return Promise.all(
        lyricsProbeSources.map(async (source) => {
          const result = await searchSource(source, { ...input, albumArtists: [] }, 'high');
          if (!result || typeof result === 'string') return { source: source.id, status: result };
          const { content } = result;
          return {
            source: source.id,
            status: 'ready',
            title: result.candidate.title,
            match: result.match.level,
            lines: content.lines.length,
            wordLevel:
              content.kind === 'synced' && content.lines.some((line) => line.words.length > 1),
            translation:
              content.kind === 'synced' && content.lines.some((line) => line.translatedLyric),
          };
        }),
      );
    }, query);
    console.log(JSON.stringify({ query: query.title, results }));
    for (const result of results) if (result.status === 'ready') hits.add(result.source);
  }
  for (const id of ['lrclib', 'netease', 'kugou', 'ttmlDb', 'lrcmux']) {
    expect.soft(hits.has(id), `${id} 至少一首样例取到歌词`).toBe(true);
  }
});
