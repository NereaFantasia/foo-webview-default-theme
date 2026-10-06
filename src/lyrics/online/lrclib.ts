import { parseLyricsText } from '../lyricsText.ts';
import {
  asList,
  asNumber,
  asText,
  field,
  lyricsGet,
  lyricsJson,
  OPEN_API_HEADERS,
  splitArtistField,
  type LyricsHttpHost,
} from './lyricsHttp.ts';
import type { LyricsCandidate, LyricsQuery, LyricsSource } from './lyricsSource.ts';

const SEARCH_URL = 'https://lrclib.net/api/search';

/** 搜索应答已带全文：有同步词用同步词，没有再退到纯文本；标成纯音乐的不带词。时长是秒。 */
function candidateOf(item: unknown): LyricsCandidate | null {
  const id = asNumber(field(item, 'id'));
  const title = asText(field(item, 'trackName'));
  if (!id || !title) return null;
  const artist = asText(field(item, 'artistName'));
  const content =
    field(item, 'instrumental') === true
      ? null
      : (parseLyricsText(asText(field(item, 'syncedLyrics'))) ??
        parseLyricsText(asText(field(item, 'plainLyrics'))));
  return {
    source: 'lrclib',
    ref: String(id),
    title,
    artists: splitArtistField(artist),
    album: asText(field(item, 'albumName')),
    durationMs: Math.round(asNumber(field(item, 'duration')) * 1000),
    ...(content ? { content } : {}),
  };
}

/** 应答不是 200 或不是数组答 null。 */
async function searchOnce(
  host: LyricsHttpHost,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<LyricsCandidate[] | null> {
  const answer = await lyricsGet(
    host,
    `${SEARCH_URL}?${new URLSearchParams(params).toString()}`,
    OPEN_API_HEADERS,
    signal,
  );
  const data = lyricsJson(answer);
  if (answer?.status !== 200 || !Array.isArray(data)) return null;
  return asList(data).flatMap((item) => candidateOf(item) ?? []);
}

/**
 * LRCLIB：免 key 的开放歌词库，逐行同步。按曲名加艺人搜；一条都没有时只按曲名再搜一次，
 * 艺人名写法不同（译名、合作艺人连写）时还能找到。不带专辑：它按专辑精确过滤，版本一不同就搜不到。
 */
export function createLrclibSource(host: LyricsHttpHost): LyricsSource {
  return {
    id: 'lrclib',
    async search(query: LyricsQuery, signal?: AbortSignal) {
      if (query.keywords)
        return (await searchOnce(host, { q: query.keywords }, signal)) ?? 'failed';
      const artist = query.artists[0] ?? '';
      const first = await searchOnce(
        host,
        { track_name: query.title, ...(artist ? { artist_name: artist } : {}) },
        signal,
      );
      if (first === null) return 'failed';
      if (first.length > 0 || !artist) return first;
      return (await searchOnce(host, { track_name: query.title }, signal)) ?? 'failed';
    },
    async fetch(candidate: LyricsCandidate) {
      return candidate.content ?? 'missing';
    },
  };
}
