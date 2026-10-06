import type { LibraryTrack } from 'foo-webview-sdk';
import { matchKey, titleKey } from '../biography/identity/artistMatch.ts';
import type {
  LastfmSimilarArtist,
  LastfmTopAlbum,
  LastfmTopTrack,
} from '../biography/lastfm-api/lastfmArtistTops.ts';
import { tidyKey } from './artistTidy.ts';

/** 热门里的一首，对上了他在库里的曲目就能播。 */
export interface TopTrackMatch extends LastfmTopTrack {
  readonly local: LibraryTrack | null;
}

/** 相似艺人里库里有的，`local` 是库里的写法。 */
export interface SimilarMatch extends LastfmSimilarArtist {
  readonly local: string | null;
}

/** 括号里或标题末尾的合作者说明：(feat. X)、[ft. X]、 feat. X、(with X)。 */
const FEATURING =
  /\s*[([（［]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]）］]*[)\]）］]|\s+(?:feat\.?|ft\.?|featuring)\s.*$/gi;

/**
 * 比曲名用的键：去掉合作者说明，再按 `matchKey` 统一大小写、全半角并去掉空白与标点。
 * 别的括号（Remix、Live、Part 3）保留：那是另一首。
 */
export function trackKey(title: string): string {
  return matchKey(title.replace(FEATURING, '') || title);
}

/**
 * 热门曲目与他的本地曲目比对。同名的有几首时取第一首（调用方按专辑与曲号排好）。
 */
export function matchTopTracks(
  tops: readonly LastfmTopTrack[],
  local: readonly LibraryTrack[],
): readonly TopTrackMatch[] {
  const byKey = new Map<string, LibraryTrack>();
  for (const track of local) {
    const key = trackKey(track.title);
    if (key && !byKey.has(key)) byKey.set(key, track);
  }
  return tops.map((top) => ({ ...top, local: byKey.get(trackKey(top.title)) ?? null }));
}

/** 热门专辑里库里没有的：标题去掉括号里的版本说明后与他的本地专辑比。 */
export function missingTopAlbums(
  tops: readonly LastfmTopAlbum[],
  localTitles: readonly string[],
): readonly LastfmTopAlbum[] {
  const owned = new Set(localTitles.map(titleKey));
  return tops.filter((top) => !owned.has(titleKey(top.title)));
}

/** 相似艺人里库里有的标出库里的写法：比较时统一大小写、全半角、变音与空白。 */
export function matchSimilar(
  similar: readonly LastfmSimilarArtist[],
  libraryArtists: readonly string[],
): readonly SimilarMatch[] {
  const byKey = new Map<string, string>();
  for (const name of libraryArtists) {
    const key = tidyKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  return similar.map((item) => ({ ...item, local: byKey.get(tidyKey(item.artist)) ?? null }));
}
