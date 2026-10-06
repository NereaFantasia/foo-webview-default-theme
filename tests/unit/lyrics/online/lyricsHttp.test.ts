import { describe, expect, it } from 'vitest';
import { lyricsGet } from '../../../../src/lyrics/online/lyricsHttp.ts';
import { createKugouSource } from '../../../../src/lyrics/online/kugou.ts';
import { createLrclibSource } from '../../../../src/lyrics/online/lrclib.ts';
import { createLrcmuxSource } from '../../../../src/lyrics/online/lrcmux.ts';
import { createNeteaseSource } from '../../../../src/lyrics/online/netease.ts';
import { createTtmlDbSource } from '../../../../src/lyrics/online/ttmlDb.ts';
import { installLyricsHttp, json } from '../../../fixtures/lyricsHttp.ts';

const QUERY = { title: 'Song', artists: ['Artist'], album: '', albumArtists: [], durationMs: 1000 };
const SOURCES = [
  createLrclibSource,
  createNeteaseSource,
  createKugouSource,
  createTtmlDbSource,
  createLrcmuxSource,
];

describe('歌词请求中止', () => {
  it('五个来源收到已中止的信号时不向宿主发搜索或下载请求', async () => {
    const http = installLyricsHttp({});
    const controller = new AbortController();
    controller.abort();
    for (const create of SOURCES) {
      const source = create(http.host);
      await source.search(QUERY, controller.signal);
      await source.fetch({ ...QUERY, source: source.id, ref: '1:key' }, controller.signal);
    }
    expect(http.requests()).toEqual([]);
  });

  it('请求等待期间中止时丢弃晚到的正文', async () => {
    const controller = new AbortController();
    const http = installLyricsHttp({
      'https://lrclib.net/api/search': () => {
        controller.abort();
        return json([]);
      },
    });
    expect(
      await lyricsGet(http.host, 'https://lrclib.net/api/search', {}, controller.signal),
    ).toBeNull();
    expect(http.requests()).toHaveLength(1);
  });

  it('LRCLIB 首次搜索等待期间中止时，不再只按曲名重搜', async () => {
    const controller = new AbortController();
    const http = installLyricsHttp({
      'https://lrclib.net/api/search': () => {
        controller.abort();
        return json([]);
      },
    });
    expect(await createLrclibSource(http.host).search(QUERY, controller.signal)).toBe('failed');
    expect(http.requests()).toHaveLength(1);
  });

  it('中止一个 TTML 索引消费者不影响另一个消费者和后续搜索', async () => {
    const controller = new AbortController();
    const http = installLyricsHttp({
      'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/metadata/raw-lyrics-index.jsonl':
        () => {
          controller.abort();
          return json({
            rawLyricFile: '1-song.ttml',
            metadata: [
              ['musicName', ['Song']],
              ['artists', ['Artist']],
            ],
          });
        },
    });
    const source = createTtmlDbSource(http.host);
    const canceled = source.search(QUERY, controller.signal);
    const other = source.search(QUERY);
    expect(await canceled).toBe('failed');
    expect(await other).toHaveLength(1);
    expect(await source.search(QUERY)).toHaveLength(1);
    expect(http.requests()).toHaveLength(1);
  });
});
