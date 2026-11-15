import { readSavedLyricsValue } from './lyricsArchive.ts';
import type { LyricsPrefs } from './lyricsPrefs.ts';
import { MATCH_LEVELS, type MatchResult } from './online/lyricsMatch.ts';
import type { FoundLyrics } from './online/lyricsSearch.ts';
import {
  LYRICS_SOURCE_IDS,
  type LyricsCandidate,
  type LyricsQuery,
} from './online/lyricsSource.ts';

/** 缓存里一条的内容：取到的歌词，或来源明确没有这首 */
export type CachedLyrics = FoundLyrics | 'missing';

/** 存档格式变了就改这一位，旧条目随键变化自然不再命中 */
const FORMAT = 1;

const field = (raw: unknown, key: string): unknown =>
  typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * 缓存键（摘要）：查询加来源与类别优先级的 SHA-256。来源或顺序改了就不命中，与自动选择随设置变化一致；
 * 键里没有文件路径，同一首歌的两个文件共用一条
 */
export async function lyricsQueryDigest(
  query: LyricsQuery,
  prefs: Pick<LyricsPrefs, 'order' | 'sources'>,
): Promise<string> {
  const text = JSON.stringify([
    FORMAT,
    query.title,
    query.artists,
    query.album,
    query.albumArtists,
    query.durationMs,
    query.neteaseId ?? '',
    prefs.sources ?? [],
    prefs.order ?? [],
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 候选里的歌词正文另存一份在 `content`，这里不重复写 */
function candidateRecord(candidate: LyricsCandidate) {
  return {
    source: candidate.source,
    ref: candidate.ref,
    title: candidate.title,
    artists: candidate.artists,
    album: candidate.album,
    durationMs: candidate.durationMs,
    ...(candidate.albumArtists ? { albumArtists: candidate.albumArtists } : {}),
    ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
  };
}

export function writeFoundLyrics(found: FoundLyrics): string {
  return JSON.stringify({
    key: '',
    source: found.source,
    content: found.content,
    candidate: candidateRecord(found.candidate),
    match: found.match,
  });
}

function readCandidate(raw: unknown): LyricsCandidate | null {
  const source = LYRICS_SOURCE_IDS.find((id) => id === field(raw, 'source'));
  const ref = field(raw, 'ref');
  const title = field(raw, 'title');
  const artists = field(raw, 'artists');
  const album = field(raw, 'album');
  const durationMs = field(raw, 'durationMs');
  const albumArtists = field(raw, 'albumArtists');
  const coverUrl = field(raw, 'coverUrl');
  if (
    !source ||
    typeof ref !== 'string' ||
    typeof title !== 'string' ||
    !isStrings(artists) ||
    typeof album !== 'string' ||
    !finite(durationMs) ||
    (albumArtists !== undefined && !isStrings(albumArtists)) ||
    (coverUrl !== undefined && typeof coverUrl !== 'string')
  )
    return null;
  return {
    source,
    ref,
    title,
    artists,
    album,
    durationMs,
    ...(albumArtists ? { albumArtists } : {}),
    ...(coverUrl ? { coverUrl } : {}),
  };
}

function readMatch(raw: unknown): MatchResult | null {
  const level = MATCH_LEVELS.find((value) => value === field(raw, 'level'));
  const points = field(raw, 'points');
  return level && finite(points) ? { level, points } : null;
}

/** 逐项校验；任何一项不合格整条当没缓存过 */
export function readFoundLyrics(text: string): FoundLyrics | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const saved = readSavedLyricsValue(raw);
  const source = LYRICS_SOURCE_IDS.find((id) => id === saved?.source);
  const candidate = readCandidate(field(raw, 'candidate'));
  const match = readMatch(field(raw, 'match'));
  return saved && source && candidate && match
    ? { content: saved.content, source, candidate, match }
    : null;
}
