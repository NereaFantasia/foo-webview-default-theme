import type { MusicTrack } from '../../server/musicObjects.ts';
import type { SearchHit } from './searchQuery.ts';
import { searchHitKey } from './searchQuery.ts';

export interface SearchSuggestion {
  readonly key: string;
  readonly group: 'recent' | 'best' | 'albums' | 'tracks' | 'online';
  readonly text?: string;
  readonly hit?: SearchHit;
  /** 在线音乐范围的一首曲目 */
  readonly online?: MusicTrack;
}

/** 下拉在线音乐范围列几首曲目 */
const ONLINE_ROWS = 5;

export function onlineSuggestions(tracks: readonly MusicTrack[]): readonly SearchSuggestion[] {
  return tracks
    .slice(0, ONLINE_ROWS)
    .map((track) => ({ key: `online:${track.ref.id}`, group: 'online', online: track }));
}

export function searchSuggestions(
  text: string,
  recent: readonly string[],
  albums: readonly Extract<SearchHit, { kind: 'album' }>[],
  tracks: readonly Extract<SearchHit, { kind: 'track' }>[],
  best: SearchHit | null,
): readonly SearchSuggestion[] {
  if (!text.trim())
    return recent.map((word) => ({ key: `recent:${word}`, text: word, group: 'recent' }));
  const bestKey = best ? searchHitKey(best) : null;
  const rows: SearchSuggestion[] = best ? [{ key: bestKey ?? '', group: 'best', hit: best }] : [];
  for (const [group, hits, limit] of [
    ['albums', albums, 3],
    ['tracks', tracks, 4],
  ] as const) {
    rows.push(
      ...hits
        .filter((hit) => searchHitKey(hit) !== bestKey)
        .slice(0, limit)
        .map((hit) => ({ key: searchHitKey(hit), group, hit })),
    );
  }
  return rows;
}

export function searchOptionId(key: string): string {
  return `search-option-${encodeURIComponent(key)}`;
}
