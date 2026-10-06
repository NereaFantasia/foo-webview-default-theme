import { describe, expect, it } from 'vitest';
import { createKugouSource, decryptKrc, parseKrc } from '../../../../src/lyrics/online/kugou.ts';
import type { LyricsCandidate, LyricsQuery } from '../../../../src/lyrics/online/lyricsSource.ts';
import { installLyricsHttp, json } from '../../../fixtures/lyricsHttp.ts';

const SEARCH = 'https://lyrics.kugou.com/search';
const DOWNLOAD = 'https://lyrics.kugou.com/download';

const KEY = [
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
];

/** 照酷狗的做法加密：zlib 压缩、逐字节异或、前面加 `krc1`，再转 base64。 */
async function encryptKrc(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  const body = packed.map((byte, index) => byte ^ (KEY[index % KEY.length] ?? 0));
  const raw = new Uint8Array([...new TextEncoder().encode('krc1'), ...body]);
  return btoa(String.fromCharCode(...raw));
}

const languageTag = (content: unknown) =>
  `[language:${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ content }))))}]`;

const KRC = [
  '[ar:林俊杰]',
  languageTag([{ type: 1, lyricContent: [['江南的译文'], ['第二行译文']] }]),
  '[1000,2000]<0,500,0>风<500,1500,0>到这里',
  '[3000,1000]<0,1000,0>就是粘',
].join('\n');

const query: LyricsQuery = {
  title: '江南',
  artists: ['林俊杰'],
  album: '',
  albumArtists: [],
  durationMs: 267_946,
};

const candidate: LyricsCandidate = {
  source: 'kugou',
  ref: '103868636:733CA696',
  title: '江南',
  artists: ['林俊杰'],
  album: '',
  durationMs: 267_946,
};

describe('KRC', () => {
  it('解密后解析成逐字行，字的时间换成绝对毫秒，[language:] 的译文按行序配上', async () => {
    const text = await decryptKrc(await encryptKrc(KRC));
    expect(text).toBe(KRC);
    expect(parseKrc(text ?? '')).toMatchObject([
      {
        startTime: 1000,
        endTime: 3000,
        translatedLyric: '江南的译文',
        words: [
          { startTime: 1000, endTime: 1500, word: '风' },
          { startTime: 1500, endTime: 3000, word: '到这里' },
        ],
      },
      { startTime: 3000, translatedLyric: '第二行译文' },
    ]);
  });

  it('不是 KRC 的正文解不出来答 null', async () => {
    expect(await decryptKrc('a3JjMQ==')).toBeNull();
    expect(await decryptKrc('不是 base64')).toBeNull();
  });
});

describe('酷狗来源', () => {
  it('按「艺人 - 曲名」与毫秒时长搜，跳过用户上传的候选，顿号连写的艺人拆开', async () => {
    const http = installLyricsHttp({
      [SEARCH]: json({
        status: 200,
        candidates: [
          {
            id: '103868636',
            accesskey: '733CA696',
            song: '江南',
            singer: '林俊杰',
            duration: 267_946,
          },
          { id: '9', accesskey: 'K', song: '江南', singer: '林俊杰', product_from: 'ugc' },
          { id: '10', accesskey: 'D', song: '江南', singer: '林俊杰、A-Lin', duration: 1 },
        ],
      }),
    });
    expect(await createKugouSource(http.host).search(query)).toEqual([
      candidate,
      { ...candidate, ref: '10:D', artists: ['林俊杰', 'A-Lin'], durationMs: 1 },
    ]);
    const params = http.requests()[0]?.url.searchParams;
    expect(params?.get('keyword')).toBe('林俊杰 - 江南');
    expect(params?.get('duration')).toBe('267946');
  });

  it('按 ref 里的 id 与 accesskey 下载 KRC，解成逐字词', async () => {
    const content = await encryptKrc(KRC);
    const http = installLyricsHttp({ [DOWNLOAD]: json({ status: 200, content, fmt: 'krc' }) });
    expect(await createKugouSource(http.host).fetch(candidate)).toMatchObject({
      kind: 'synced',
      lines: [{ words: [{ word: '风' }, { word: '到这里' }] }, { words: [{ word: '就是粘' }] }],
    });
    const params = http.requests()[0]?.url.searchParams;
    expect(params?.get('id')).toBe('103868636');
    expect(params?.get('accesskey')).toBe('733CA696');
    expect(params?.get('fmt')).toBe('krc');
  });

  it('正文为空答没有；凭据不对（status 403）与解不开的正文答失败', async () => {
    const empty = installLyricsHttp({ [DOWNLOAD]: json({ status: 200, content: '' }) });
    expect(await createKugouSource(empty.host).fetch(candidate)).toBe('missing');
    const denied = installLyricsHttp({
      [DOWNLOAD]: json({ status: 403, info: 'Bad Accesskey', content: '' }),
    });
    expect(await createKugouSource(denied.host).fetch(candidate)).toBe('failed');
    const garbled = installLyricsHttp({ [DOWNLOAD]: json({ status: 200, content: 'a3JjMQ==' }) });
    expect(await createKugouSource(garbled.host).fetch(candidate)).toBe('failed');
  });
});
