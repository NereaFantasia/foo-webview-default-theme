import type { Track } from 'foo-webview-sdk';
import { anyIs, isQueryableValue } from '../../track/trackQuery.ts';

// 歌曲页的分面：流派、年代、艺术家三栏，栏内或、跨栏与。取值与数目按整库的曲目算（一首有两个流派就在两个流派
// 里各算一首），勾选拼成查询交给宿主，表格与填表起播都按那串查询。值写不进查询（带引号、通配符）的不列。

export const SONG_FACETS = ['genre', 'decade', 'artist'] as const;
export type SongFacet = (typeof SONG_FACETS)[number];

export type SongFacetSelection = Readonly<Record<SongFacet, ReadonlySet<string>>>;

export interface SongFacetValue {
  readonly name: string;
  /** 带这个值的曲目数。 */
  readonly count: number;
}

export type SongFacetOptions = Readonly<Record<SongFacet, readonly SongFacetValue[]>>;

export const EMPTY_SONG_FACETS: SongFacetSelection = {
  genre: new Set(),
  decade: new Set(),
  artist: new Set(),
};

/** 没写日期的那一档。 */
export const UNKNOWN_DECADE = 'unknown';

export type FacetTrack = Pick<Track, 'genre' | 'date' | 'artist' | 'artists'>;

/**
 * 年代按日期开头的四位年份归：`1998-05-01`、`1998.05.01` 都归 `1990s`；没写日期的归「未知」。日期写了却不以
 * 年份开头的不归任何一档：查询里按日期的前三个字认年代，这种写法认不出来。
 */
export function decadeOf(date: string): string | null {
  if (date.trim() === '') return UNKNOWN_DECADE;
  return /^\d{4}/.test(date) ? `${date.slice(0, 3)}0s` : null;
}

/** 曲目的几个流派：宿主给的是用「, 」连起来的串。 */
export function genresOf(track: Pick<Track, 'genre'>): string[] {
  return track.genre === '' ? [] : track.genre.split(', ');
}

function artistsOf(track: Pick<Track, 'artist' | 'artists'>): readonly string[] {
  return track.artists.length > 0 ? track.artists : track.artist ? [track.artist] : [];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function byCount(counts: ReadonlyMap<string, number>): SongFacetValue[] {
  return [...counts]
    .filter(([name]) => isQueryableValue(name))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
}

const bump = (counts: Map<string, number>, name: string) =>
  counts.set(name, (counts.get(name) ?? 0) + 1);

/** 三栏的取值：流派与艺术家按首数多的在前、同数按名字；年代新的在前，「未知」垫底。 */
export function songFacetOptions(tracks: Iterable<FacetTrack>): SongFacetOptions {
  const genres = new Map<string, number>();
  const decades = new Map<string, number>();
  const artists = new Map<string, number>();
  for (const track of tracks) {
    for (const genre of new Set(genresOf(track))) bump(genres, genre);
    const decade = decadeOf(track.date);
    if (decade !== null) bump(decades, decade);
    for (const artist of new Set(artistsOf(track))) bump(artists, artist);
  }
  const decade = [...decades]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      a.name === UNKNOWN_DECADE ? 1 : b.name === UNKNOWN_DECADE ? -1 : b.name.localeCompare(a.name),
    );
  return { genre: byCount(genres), decade, artist: byCount(artists) };
}

export function songFacetCount(selection: SongFacetSelection): number {
  return SONG_FACETS.reduce((count, facet) => count + selection[facet].size, 0);
}

/** 勾上或取消一个值，返回新的一份；原来的不改。 */
export function toggleSongFacet(
  selection: SongFacetSelection,
  facet: SongFacet,
  name: string,
): SongFacetSelection {
  const next = new Set(selection[facet]);
  if (!next.delete(name)) next.add(name);
  return { ...selection, [facet]: next };
}

/** 年代一档写成的查询：日期的前三个字，没写日期的是 `NOT date PRESENT`。 */
function decadeQuery(decade: string): string {
  return decade === UNKNOWN_DECADE
    ? 'NOT date PRESENT'
    : `"$left(%date%,3)" IS ${decade.slice(0, 3)}`;
}

/** 勾选拼成的几段查询，每栏一段；一栏都没勾时是空数组。 */
export function songFacetQueries(selection: SongFacetSelection): string[] {
  const parts: string[] = [];
  if (selection.genre.size > 0) parts.push(anyIs('genre', [...selection.genre]));
  if (selection.decade.size > 0) {
    const terms = [...selection.decade].map(decadeQuery);
    parts.push(terms.length > 1 ? terms.join(' OR ') : (terms[0] ?? ''));
  }
  if (selection.artist.size > 0) parts.push(anyIs('artist', [...selection.artist]));
  return parts;
}

/**
 * 库变了之后，勾选里已不在取值清单上的值剔掉：库里已经没有曲目带着它，留着会筛出 0 首、清单里又没有这一项可以
 * 取消。没有要剔的时原样答回，调用方可按引用判断。
 */
export function pruneSongFacets(
  selection: SongFacetSelection,
  options: SongFacetOptions,
): SongFacetSelection {
  let changed = false;
  const next = { ...selection };
  for (const facet of SONG_FACETS) {
    const offered = new Set(options[facet].map((value) => value.name));
    const kept = new Set([...selection[facet]].filter((name) => offered.has(name)));
    if (kept.size !== selection[facet].size) {
      next[facet] = kept;
      changed = true;
    }
  }
  return changed ? next : selection;
}
