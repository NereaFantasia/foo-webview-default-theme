import { describe, expect, it } from 'vitest';
import { createLrcmuxSource } from '../../../../src/lyrics/online/lrcmux.ts';
import type { LyricsQuery } from '../../../../src/lyrics/online/lyricsSource.ts';
import { installLyricsHttp, json } from '../../../fixtures/lyricsHttp.ts';

const GET = 'https://api.lrcmux.dev/get';

const query: LyricsQuery = {
  title: 'アイドル',
  artists: ['YOASOBI'],
  album: 'アイドル',
  albumArtists: [],
  durationMs: 213_400,
};

const track = {
  isrc: 'JPP302300157',
  title: 'アイドル',
  artist: 'YOASOBI',
  album: 'アイドル',
  duration: 213,
};

describe('lrcmux 来源', () => {
  it('带曲名、艺人、专辑与按秒的时长去取；逐字应答整理成逐字行，曲目信息取自 track', async () => {
    const http = installLyricsHttp({
      [GET]: json({
        track,
        meta: { source: { id: 'kugou' }, level: 'word' },
        lines: [
          {
            text: '無敵の',
            start: 1659,
            end: 2380,
            words: [
              { text: '無敵', start: 1659, end: 2203 },
              { text: 'の', start: 2203, end: 2380 },
            ],
          },
        ],
      }),
    });
    const found = await createLrcmuxSource(http.host).search(query);
    expect(found).toMatchObject([
      {
        source: 'lrcmux',
        ref: 'JPP302300157',
        title: 'アイドル',
        artists: ['YOASOBI'],
        durationMs: 213_000,
        content: {
          kind: 'synced',
          lines: [{ startTime: 1659, endTime: 2380, words: [{ word: '無敵' }, { word: 'の' }] }],
        },
      },
    ]);
    const params = http.requests()[0]?.url.searchParams;
    expect(Object.fromEntries(params ?? [])).toEqual({
      title: 'アイドル',
      artist: 'YOASOBI',
      album: 'アイドル',
      duration: '213',
    });
    expect(String(http.requests()[0]?.header('User-Agent'))).toMatch(
      /^foo-webview-default-theme\//,
    );
  });

  it('逐行应答每行一个字；没有时间轴的按纯文本', async () => {
    const line = installLyricsHttp({
      [GET]: json({
        track,
        meta: { level: 'line' },
        lines: [{ text: '一行', start: 1000, end: 2000 }],
      }),
    });
    expect(await createLrcmuxSource(line.host).search(query)).toMatchObject([
      { content: { kind: 'synced', lines: [{ words: [{ word: '一行', startTime: 1000 }] }] } },
    ]);
    const plain = installLyricsHttp({
      [GET]: json({ track, meta: { level: 'none' }, lines: [{ text: '一行' }, { text: '二行' }] }),
    });
    expect(await createLrcmuxSource(plain.host).search(query)).toMatchObject([
      { content: { kind: 'plain', lines: ['一行', '二行'] } },
    ]);
  });

  it('纯音乐的候选不带词，取词答没有', async () => {
    const http = installLyricsHttp({
      [GET]: json({ track, meta: { level: 'none', instrumental: true }, lines: [] }),
    });
    const source = createLrcmuxSource(http.host);
    const found = await source.search(query);
    const hit = found === 'failed' ? undefined : found[0];
    if (!hit) throw new Error('没有候选');
    expect(hit.content).toBeUndefined();
    expect(await source.fetch(hit)).toBe('missing');
  });

  it('404 答空数组；限流与服务出错答失败', async () => {
    const missing = installLyricsHttp({
      [GET]: json({ status: 404, detail: 'no lyrics found' }, 404),
    });
    expect(await createLrcmuxSource(missing.host).search(query)).toEqual([]);
    const limited = installLyricsHttp({ [GET]: json({ status: 429 }, 429) });
    expect(await createLrcmuxSource(limited.host).search(query)).toBe('failed');
  });
});
