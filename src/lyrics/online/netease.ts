import type { LyricLine } from '@applemusic-like-lyrics/core';
import { parseYrc } from '@applemusic-like-lyrics/lyric';
import {
  attachLineTexts,
  parseLyricsText,
  syncedContent,
  type LyricsContent,
} from '../lyricsText.ts';
import {
  asList,
  asNumber,
  asText,
  field,
  lyricsGet,
  lyricsJson,
  type LyricsHttpHost,
} from './lyricsHttp.ts';
import type { LyricsCandidate, LyricsQuery, LyricsSource } from './lyricsSource.ts';

const SEARCH_URL = 'https://music.163.com/api/search/get/web';
const LYRIC_URL = 'https://music.163.com/api/song/lyric/v1';
const DETAIL_URL = 'https://music.163.com/api/song/detail/';
/** 照网页客户端的请求头。 */
const HEADERS = { Referer: 'https://music.163.com/', Cookie: 'appver=1.5.0.75771' };
const SEARCH_LIMIT = 10;

function candidateOf(item: unknown): LyricsCandidate | null {
  const id = asNumber(field(item, 'id'));
  const title = asText(field(item, 'name'));
  if (!id || !title) return null;
  const coverUrl = asText(field(field(item, 'album'), 'picUrl'));
  return {
    source: 'netease',
    ref: String(id),
    title,
    artists: asList(field(item, 'artists'))
      .map((artist) => asText(field(artist, 'name')))
      .filter(Boolean),
    album: asText(field(field(item, 'album'), 'name')),
    durationMs: asNumber(field(item, 'duration')),
    ...(coverUrl ? { coverUrl } : {}),
  };
}

function yrcLines(text: string): LyricLine[] {
  if (!text) return [];
  try {
    return parseYrc(text);
  } catch {
    return [];
  }
}

/** 另给的译文与音译按行首时间并进去；两份都是逐行 LRC，空串就不并。 */
function withExtras(
  lines: readonly LyricLine[],
  translation: string,
  roman: string,
): LyricsContent | null {
  let merged = [...lines];
  if (translation) merged = attachLineTexts(merged, translation, 'translatedLyric');
  if (roman) merged = attachLineTexts(merged, roman, 'romanLyric');
  return syncedContent(merged);
}

/**
 * 网易云音乐：网页端搜索接口与不加密的 v1 歌词接口。有 YRC 逐字词时用它，配 YRC 那套时间写的译文
 * 与音译；没有再用逐行 LRC。应答前几行是 JSON 写的作词作曲信息，两种解析都跳过不是方括号开头的行。
 */
export function createNeteaseSource(host: LyricsHttpHost): LyricsSource {
  return {
    id: 'netease',
    async search(query: LyricsQuery, signal?: AbortSignal) {
      const params = new URLSearchParams({
        s: query.keywords ?? [query.title, query.artists[0]].filter(Boolean).join(' '),
        type: '1',
        offset: '0',
        limit: String(SEARCH_LIMIT),
      });
      const answer = await lyricsGet(host, `${SEARCH_URL}?${params.toString()}`, HEADERS, signal);
      const data = lyricsJson(answer);
      if (answer?.status !== 200 || asNumber(field(data, 'code')) !== 200) return 'failed';
      return asList(field(field(data, 'result'), 'songs')).flatMap(
        (item) => candidateOf(item) ?? [],
      );
    },
    async cover(ref, signal) {
      if (!/^\d+$/.test(ref)) return '';
      const params = new URLSearchParams({ ids: `[${ref}]` });
      const answer = await lyricsGet(host, `${DETAIL_URL}?${params.toString()}`, HEADERS, signal);
      const data = lyricsJson(answer);
      if (answer?.status !== 200 || asNumber(field(data, 'code')) !== 200) return '';
      const song = asList(field(data, 'songs')).find(
        (item) => String(asNumber(field(item, 'id'))) === ref,
      );
      return asText(field(field(song, 'album'), 'picUrl'));
    },
    async fetch(candidate: LyricsCandidate, signal?: AbortSignal) {
      // lv、kv、tv、rv 要逐行词、卡拉 OK 词、译文、音译；yv、ytv、yrv 要 YRC 与配它的译文、音译。
      const params = new URLSearchParams({
        id: candidate.ref,
        lv: '1',
        kv: '1',
        tv: '-1',
        rv: '-1',
        yv: '1',
        ytv: '1',
        yrv: '1',
      });
      const answer = await lyricsGet(host, `${LYRIC_URL}?${params.toString()}`, HEADERS, signal);
      const data = lyricsJson(answer);
      if (answer?.status !== 200 || asNumber(field(data, 'code')) !== 200) return 'failed';
      // 纯音乐与没有词的曲目各有标记；没收录的只是 lrc 为空串。
      if (field(data, 'pureMusic') === true || field(data, 'nolyric') === true) return 'missing';
      const text = (key: string) => asText(field(field(data, key), 'lyric'));
      const words = yrcLines(text('yrc'));
      if (syncedContent(words)) {
        return (
          withExtras(words, text('ytlrc') || text('tlyric'), text('yromalrc') || text('romalrc')) ??
          'missing'
        );
      }
      const content = parseLyricsText(text('lrc'));
      if (!content) return 'missing';
      if (content.kind === 'plain') return content;
      return withExtras(content.lines, text('tlyric'), text('romalrc')) ?? 'missing';
    },
  };
}
