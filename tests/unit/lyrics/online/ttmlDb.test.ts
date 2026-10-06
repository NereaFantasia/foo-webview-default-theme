import { describe, expect, it } from 'vitest';
import type { LyricsQuery } from '../../../../src/lyrics/online/lyricsSource.ts';
import { createTtmlDbSource } from '../../../../src/lyrics/online/ttmlDb.ts';
import { installLyricsHttp, type LyricsReply } from '../../../fixtures/lyricsHttp.ts';

const BASE = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main';
const INDEX = `${BASE}/metadata/raw-lyrics-index.jsonl`;

const query: LyricsQuery = {
  title: 'アイドル',
  artists: ['YOASOBI'],
  album: 'アイドル',
  albumArtists: [],
  durationMs: 213_000,
};

const line = (file: string, metadata: Record<string, string[]>) =>
  JSON.stringify({ metadata: Object.entries(metadata), rawLyricFile: file });

const idol = { musicName: ['アイドル', 'Idol'], artists: ['YOASOBI'], album: ['アイドル'] };

const INDEX_TEXT = [
  line('1689089845000-1-old.ttml', { ...idol, ncmMusicId: ['2048982668'] }),
  line('1689318244000-1-new.ttml', { ...idol, ncmMusicId: ['2048982668'] }),
  line('1700000000000-2-a.ttml', { musicName: ['夜に駆ける'], artists: ['YOASOBI'] }),
  line('1700000000000-3-b.ttml', { artists: ['缺曲名'] }),
  '不是 JSON 的行',
].join('\n');

function setup(index: LyricsReply = { body: INDEX_TEXT }) {
  const http = installLyricsHttp({
    [INDEX]: index,
    [`${BASE}/raw-lyrics/1689318244000-1-new.ttml`]: { body: '[00:01.00]無敵の笑顔で' },
  });
  return { http, source: createTtmlDbSource(http.host) };
}

describe('AMLL TTML DB 来源', () => {
  it('关键词跨曲名、别名与艺人匹配，不受当前曲目匹配门槛限制', async () => {
    const { source } = setup();
    const found = await source.search({
      ...query,
      title: '其他曲目',
      artists: [],
      keywords: 'yoasobi Idol',
    });
    expect(found).toMatchObject([{ ref: '1689318244000-1-new.ttml', title: 'Idol' }]);
    expect(found).toHaveLength(1);
    expect(await source.search({ ...query, keywords: '不存在的词' })).toEqual([]);
  });
  it('同一首的多次提交只留最新的一份，按匹配分排；按别名也能对上，曲名取对得最好的那个', async () => {
    const { source } = setup();
    const found = await source.search(query);
    // 同艺人的另一首只有艺人对得上，排在后面，由调度按门槛挡掉。
    expect(found === 'failed' ? found : found.map((item) => item.ref)).toEqual([
      '1689318244000-1-new.ttml',
      '1700000000000-2-a.ttml',
    ]);
    expect(found === 'failed' ? found : found[0]).toEqual({
      source: 'ttmlDb',
      ref: '1689318244000-1-new.ttml',
      title: 'アイドル',
      artists: ['YOASOBI'],
      album: 'アイドル',
      durationMs: 0,
    });
    const english = await source.search({ ...query, title: 'Idol' });
    expect(english === 'failed' ? english : english[0]).toMatchObject({
      ref: '1689318244000-1-new.ttml',
      title: 'Idol',
    });
  });

  it('索引只取一次，之后的搜索都用它', async () => {
    const { http, source } = setup();
    await source.search(query);
    await source.search({ ...query, title: '夜に駆ける' });
    expect(http.requests().filter((request) => request.url.href === INDEX)).toHaveLength(1);
  });

  it('索引没取到时答失败，下一次搜索重新取', async () => {
    const { http, source } = setup({ status: 500, body: '' });
    expect(await source.search(query)).toBe('failed');
    expect(await source.search(query)).toBe('failed');
    expect(http.requests()).toHaveLength(2);
  });

  it('取词按文件名到 raw-lyrics 下取；文件不在答没有', async () => {
    const { source } = setup();
    const [hit] = await source.search(query).then((found) => (found === 'failed' ? [] : found));
    if (!hit) throw new Error('没有候选');
    // TTML 解析要 DOMParser，单测环境没有；这里用 LRC 正文只验证取词的路径。
    expect(await source.fetch(hit)).toMatchObject({ kind: 'synced' });
    expect(await source.fetch({ ...hit, ref: 'gone.ttml' })).toBe('missing');
  });
});
