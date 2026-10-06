import { describe, expect, it } from 'vitest';
import type { LyricsCandidate, LyricsQuery } from '../../../../src/lyrics/online/lyricsSource.ts';
import { createNeteaseSource } from '../../../../src/lyrics/online/netease.ts';
import { installLyricsHttp, json } from '../../../fixtures/lyricsHttp.ts';

const SEARCH = 'https://music.163.com/api/search/get/web';
const LYRIC = 'https://music.163.com/api/song/lyric/v1';

const query: LyricsQuery = {
  title: 'アイドル',
  artists: ['YOASOBI', 'Ayase'],
  album: 'アイドル',
  albumArtists: [],
  durationMs: 213_000,
};

const candidate: LyricsCandidate = {
  source: 'netease',
  ref: '2048982668',
  title: 'アイドル',
  artists: ['YOASOBI'],
  album: 'アイドル',
  durationMs: 213_233,
};

/** 网易云把作词作曲写成 JSON 行放在最前面。 */
const CREDIT = '{"t":0,"c":[{"tx":"作词: "},{"tx":"Ayase"}]}';

const lyricReply = (fields: Record<string, unknown>) =>
  json({ code: 200, lrc: { version: 1, lyric: '' }, ...fields });

describe('网易云来源', () => {
  it('按曲名加第一位艺人搜，带网页端请求头；候选取 id、艺人、专辑与毫秒时长', async () => {
    const http = installLyricsHttp({
      [SEARCH]: json({
        code: 200,
        result: {
          songs: [
            {
              id: 2048982668,
              name: 'アイドル',
              artists: [{ name: 'YOASOBI' }],
              album: { name: 'アイドル' },
              duration: 213_233,
            },
            { id: 0, name: '缺 id 的不要' },
          ],
        },
      }),
    });
    expect(await createNeteaseSource(http.host).search(query)).toEqual([candidate]);
    const [request] = http.requests();
    expect(request?.url.searchParams.get('s')).toBe('アイドル YOASOBI');
    expect(request?.header('Referer')).toBe('https://music.163.com/');
  });

  it('搜不到时 result 里没有 songs，答空数组；code 不是 200 答失败', async () => {
    const empty = installLyricsHttp({ [SEARCH]: json({ code: 200, result: { songCount: 0 } }) });
    expect(await createNeteaseSource(empty.host).search(query)).toEqual([]);
    const limited = installLyricsHttp({ [SEARCH]: json({ code: -460, message: 'Cheating' }) });
    expect(await createNeteaseSource(limited.host).search(query)).toBe('failed');
  });

  it('有 YRC 时取逐字词，配上 YRC 那套时间的译文；JSON 写的信息行跳过', async () => {
    const http = installLyricsHttp({
      [LYRIC]: lyricReply({
        lrc: { lyric: `${CREDIT}\n[00:01.000]無敵の笑顔で` },
        yrc: { lyric: `${CREDIT}\n[1000,2000](1000,500,0)無敵(1500,1500,0)の笑顔で` },
        ytlrc: { lyric: '[00:01.000]用无敌的笑容' },
        tlyric: { lyric: '[00:01.200]逐行那套的译文' },
      }),
    });
    const content = await createNeteaseSource(http.host).fetch(candidate);
    expect(content).toMatchObject({
      kind: 'synced',
      lines: [
        {
          startTime: 1000,
          translatedLyric: '用无敌的笑容',
          words: [{ word: '無敵' }, { word: 'の笑顔で' }],
        },
      ],
    });
    const params = http.requests()[0]?.url.searchParams;
    expect(params?.get('id')).toBe('2048982668');
    expect(params?.get('yv')).toBe('1');
  });

  it('没有 YRC 时用逐行 LRC，并上译文与音译', async () => {
    const http = installLyricsHttp({
      [LYRIC]: lyricReply({
        lrc: { lyric: `${CREDIT}\n[00:01.00]一行\n[00:03.00]二行` },
        tlyric: { lyric: '[00:01.00]第一行\n[00:03.00]//' },
        romalrc: { lyric: '[00:03.00]ni gyou' },
      }),
    });
    expect(await createNeteaseSource(http.host).fetch(candidate)).toMatchObject({
      kind: 'synced',
      lines: [
        { startTime: 1000, translatedLyric: '第一行', romanLyric: '' },
        { startTime: 3000, translatedLyric: '', romanLyric: 'ni gyou' },
      ],
    });
  });

  it('纯音乐、没有词与未收录都答没有；code 不是 200 答失败', async () => {
    for (const fields of [{ pureMusic: true }, { nolyric: true }, { uncollected: true }]) {
      const http = installLyricsHttp({ [LYRIC]: lyricReply(fields) });
      expect(await createNeteaseSource(http.host).fetch(candidate)).toBe('missing');
    }
    const broken = installLyricsHttp({ [LYRIC]: json({ code: 400 }) });
    expect(await createNeteaseSource(broken.host).fetch(candidate)).toBe('failed');
  });
});
