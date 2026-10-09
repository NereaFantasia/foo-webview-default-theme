import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core';
import { plainContent, syncedContent, type LyricsContent } from '../lyricsText.ts';
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

const GET_URL = 'https://api.lrcmux.dev/get';

/** `level` 是 word、line、none：逐字带 `words`，逐行只有行的起止，none 连起止都没有。时间是毫秒。 */
function contentOf(level: string, rows: readonly unknown[]): LyricsContent | null {
  if (level === 'none') {
    return plainContent(rows.map((row) => asText(field(row, 'text'))).join('\n'));
  }
  const lines = rows.map((row): LyricLine => {
    const text = asText(field(row, 'text'));
    const startTime = asNumber(field(row, 'start'));
    const endTime = asNumber(field(row, 'end'));
    const words =
      level === 'word'
        ? asList(field(row, 'words')).map((word): LyricWord => ({
            startTime: asNumber(field(word, 'start')),
            endTime: asNumber(field(word, 'end')),
            word: asText(field(word, 'text')),
          }))
        : [];
    return {
      words: words.length > 0 ? words : [{ startTime, endTime, word: text }],
      translatedLyric: '',
      romanLyric: '',
      startTime,
      endTime,
      isBG: false,
      isDuet: false,
    };
  });
  return syncedContent(lines);
}

/**
 * lrcmux：自己再去问酷狗、LRCLIB 等几家、只回最好的一份的聚合服务，作备选。公共实例每个 IP 每分钟 60 次，
 * 命中它的缓存不计数。时长按秒传。应答里的 `track` 是它从 Deezer 查到的曲目信息，不是出词那家给的：
 * 打分照样用它，但时长对得上不保证词的时间轴对得上，它会交回时长差近 30 秒的版本的词。
 */
export function createLrcmuxSource(host: LyricsHttpHost): LyricsSource {
  return {
    id: 'lrcmux',
    async search(query: LyricsQuery, signal?: AbortSignal) {
      if (query.keywords || !query.title.trim() || !query.artists[0]?.trim()) return [];
      const params = new URLSearchParams({ title: query.title, artist: query.artists[0] });
      if (query.album) params.set('album', query.album);
      if (query.durationMs > 0) params.set('duration', String(Math.round(query.durationMs / 1000)));
      const answer = await lyricsGet(
        host,
        `${GET_URL}?${params.toString()}`,
        OPEN_API_HEADERS,
        signal,
      );
      if (answer?.status === 404) return [];
      const data = lyricsJson(answer);
      if (answer?.status !== 200 || !data) return 'failed';
      const track = field(data, 'track');
      const meta = field(data, 'meta');
      const title = asText(field(track, 'title'));
      if (!title) return [];
      const artist = asText(field(track, 'artist'));
      const cover = field(track, 'cover');
      const coverUrl = asText(field(cover, 'medium')) || asText(field(cover, 'small'));
      const content =
        field(meta, 'instrumental') === true
          ? null
          : contentOf(asText(field(meta, 'level')), asList(field(data, 'lines')));
      return [
        {
          source: 'lrcmux',
          ref: asText(field(track, 'isrc')),
          title,
          artists: splitArtistField(artist),
          album: asText(field(track, 'album')),
          durationMs: asNumber(field(track, 'duration')) * 1000,
          ...(coverUrl ? { coverUrl } : {}),
          ...(content ? { content } : {}),
        },
      ];
    },
    async fetch(candidate: LyricsCandidate) {
      return candidate.content ?? 'missing';
    },
  };
}
