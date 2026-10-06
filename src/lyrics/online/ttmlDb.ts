import { parseLyricsText } from '../lyricsText.ts';
import { asList, asText, field, lyricsGet, type LyricsHttpHost } from './lyricsHttp.ts';
import { compareTrack } from './lyricsMatch.ts';
import type { LyricsCandidate, LyricsQuery, LyricsSource } from './lyricsSource.ts';

/** AMLL TTML DB：社区贡献的 TTML 逐字词，CC0。没有搜索接口，整份索引取回来在本地匹配。 */
const BASE_URL = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main';
const INDEX_URL = `${BASE_URL}/metadata/raw-lyrics-index.jsonl`;
/** 一次搜索最多交出几条候选，按匹配分从高到低取。 */
const SEARCH_LIMIT = 10;
/** 认同一首用的平台 id，按这个顺序取第一个有的。 */
const ID_KEYS = ['ncmMusicId', 'qqMusicId', 'appleMusicId', 'spotifyId'] as const;

interface IndexEntry {
  /** 第一个是正式曲名，其余是别名。 */
  readonly titles: readonly string[];
  readonly artists: readonly string[];
  readonly album: string;
  /** `raw-lyrics/` 下的文件名，以提交时的毫秒时间戳开头。 */
  readonly file: string;
}

/** 索引的一行：`metadata` 是「键, 值数组」的列表，`rawLyricFile` 是文件名。缺曲名或文件名的行不要。 */
function entryOf(line: string): { entry: IndexEntry; song: string; stamp: number } | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const file = asText(field(value, 'rawLyricFile'));
  const meta = new Map<string, string[]>();
  for (const pair of asList(field(value, 'metadata'))) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue;
    meta.set(pair[0], asList(pair[1]).map(asText).filter(Boolean));
  }
  const titles = meta.get('musicName') ?? [];
  if (!file || titles.length === 0) return null;
  const artists = meta.get('artists') ?? [];
  const id = ID_KEYS.map((key) => meta.get(key)?.[0]).find(Boolean);
  return {
    entry: { titles, artists, album: meta.get('album')?.[0] ?? '', file },
    song: id ? `id:${id}` : `name:${titles[0] ?? ''}\n${artists.join('\n')}`,
    stamp: Number.parseInt(file, 10) || 0,
  };
}

/** 同一首会被多次提交修订：按平台 id（没有时按曲名加艺人）认成同一首，只留最新提交的一份。 */
function parseIndex(text: string): IndexEntry[] {
  const latest = new Map<string, { entry: IndexEntry; stamp: number }>();
  for (const line of text.split('\n')) {
    const parsed = line.trim() ? entryOf(line) : null;
    if (!parsed) continue;
    const kept = latest.get(parsed.song);
    if (!kept || parsed.stamp >= kept.stamp) latest.set(parsed.song, parsed);
  }
  return [...latest.values()].map((item) => item.entry);
}

/** 一条索引按曲名与各个别名分别打分，取分最高的那个名字作候选的曲名；一个都对不上答 null。 */
function bestCandidateOf(
  query: LyricsQuery,
  entry: IndexEntry,
): { candidate: LyricsCandidate; score: number } | null {
  let best: { candidate: LyricsCandidate; score: number } | null = null;
  for (const title of entry.titles) {
    const candidate: LyricsCandidate = {
      source: 'ttmlDb',
      ref: entry.file,
      title,
      artists: entry.artists,
      album: entry.album,
      durationMs: 0,
    };
    if (query.keywords) {
      const text = [title, ...entry.artists, entry.album].join(' ').normalize('NFKC').toLowerCase();
      const terms = query.keywords.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.every((term) => text.includes(term))) continue;
    }
    const match = compareTrack(query, candidate);
    if ((query.keywords || match.level !== 'none') && (!best || match.points > best.score)) {
      best = { candidate, score: match.points };
    }
  }
  return best;
}

/**
 * 索引约 1.6 MB，每个来源实例只取一次，之后的搜索都用它；没取到（网络失败、不是索引内容）时不记住，
 * 下一次搜索再取。索引里没有时长，候选的时长记 0，匹配时不计这一项。
 */
export function createTtmlDbSource(host: LyricsHttpHost): LyricsSource {
  let index: Promise<IndexEntry[] | null> | null = null;

  async function loadIndex(): Promise<IndexEntry[] | null> {
    const pending = (index ??= lyricsGet(host, INDEX_URL).then((answer) => {
      const entries = answer?.status === 200 ? parseIndex(answer.body) : [];
      return entries.length > 0 ? entries : null;
    }));
    const entries = await pending;
    if (entries === null && index === pending) index = null;
    return entries;
  }

  return {
    id: 'ttmlDb',
    async search(query: LyricsQuery, signal?: AbortSignal) {
      if (signal?.aborted) return 'failed';
      // 索引由同时搜索的曲目共用；中止本次搜索不丢掉仍可供其他搜索使用的索引。
      const entries = await loadIndex();
      if (!entries || signal?.aborted) return 'failed';
      return entries
        .flatMap((entry) => bestCandidateOf(query, entry) ?? [])
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_LIMIT)
        .map((item) => item.candidate);
    },
    async fetch(candidate: LyricsCandidate, signal?: AbortSignal) {
      const answer = await lyricsGet(
        host,
        `${BASE_URL}/raw-lyrics/${encodeURIComponent(candidate.ref)}`,
        undefined,
        signal,
      );
      if (answer?.status === 404) return 'missing';
      if (answer?.status !== 200) return 'failed';
      return parseLyricsText(answer.body) ?? 'failed';
    },
  };
}
