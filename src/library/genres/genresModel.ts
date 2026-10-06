import type { LibraryTrack } from 'foo-webview-sdk';
import {
  albumKeyOf,
  trackAlbumKeyOf,
  type Album,
  type AlbumKey,
} from '../../host/libraryContract.ts';

/** 标签不能包含 NUL，保留此主体表示没有流派的曲目。 */
export const EMPTY_GENRE = '\0';

export interface GenreEntry {
  readonly key: string;
  readonly tracks: readonly LibraryTrack[];
  readonly albums: readonly Album[];
  readonly albumCount: number;
  readonly duration: number;
  readonly artists: readonly string[];
  readonly issue: 'duplicate' | 'combined' | null;
}

export type GenreSort = 'name' | 'tracks' | 'albums';

const canonical = (name: string) =>
  name.normalize('NFKC').toLocaleLowerCase().replace(/[\s-]/g, '');

/** 每首在一个流派里只算一次；同张专辑属于几个流派时，各边都保留。 */
export function buildGenres(
  tracks: readonly LibraryTrack[],
  values: ReadonlyMap<string, readonly string[]>,
  albums: readonly Album[],
): readonly GenreEntry[] {
  const grouped = new Map<string, LibraryTrack[]>();
  const knownAlbums = new Map(albums.map((album) => [albumKeyOf(album), album]));
  for (const track of tracks) {
    const names = values.get(track.handle) ?? [];
    for (const key of new Set(names.length > 0 ? names : [EMPTY_GENRE])) {
      const rows = grouped.get(key);
      if (rows) rows.push(track);
      else grouped.set(key, [track]);
    }
  }
  const spellings = new Map<string, number>();
  for (const key of grouped.keys()) {
    const name = canonical(key);
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
  }
  return [...grouped].map(([key, rows]) => {
    const counts = new Map<AlbumKey, number>();
    const artists = new Map<string, number>();
    let duration = 0;
    for (const track of rows) {
      const album = trackAlbumKeyOf(track);
      if (album) counts.set(album, (counts.get(album) ?? 0) + 1);
      duration += track.duration;
      for (const artist of new Set(track.artists))
        artists.set(artist, (artists.get(artist) ?? 0) + 1);
    }
    return {
      key,
      tracks: rows,
      albums: [...counts].sort((a, b) => b[1] - a[1]).flatMap(([id]) => knownAlbums.get(id) ?? []),
      albumCount: counts.size,
      duration,
      artists: [...artists]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name]) => name),
      issue:
        key === EMPTY_GENRE
          ? null
          : (spellings.get(canonical(key)) ?? 0) > 1
            ? 'duplicate'
            : /[/,;&]/.test(key)
              ? 'combined'
              : null,
    };
  });
}

export function filterGenres(
  entries: readonly GenreEntry[],
  text: string,
  tidy: boolean,
  sort: GenreSort,
  descending: boolean,
  locale: string,
): readonly GenreEntry[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const needle = text.trim().toLocaleLowerCase();
  return entries
    .filter(
      (entry) =>
        (!tidy || entry.issue !== null) &&
        (!needle || entry.key.toLocaleLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if (a.key === EMPTY_GENRE || b.key === EMPTY_GENRE)
        return Number(a.key === EMPTY_GENRE) - Number(b.key === EMPTY_GENRE);
      const primary =
        sort === 'tracks'
          ? a.tracks.length - b.tracks.length
          : sort === 'albums'
            ? a.albumCount - b.albumCount
            : collator.compare(a.key, b.key);
      const result =
        primary || collator.compare(a.key, b.key) || (a.key === b.key ? 0 : a.key < b.key ? -1 : 1);
      return descending ? -result : result;
    });
}

/** IS 中的通配符与引号不能作为字面值转义；这类名字仍可浏览，不拼成另一串条件。 */
export function genresQuery(keys: readonly string[]): string | null {
  if (
    keys.length === 0 ||
    keys.some(
      (key) =>
        key !== EMPTY_GENRE &&
        (key === '' || /["*?]/.test(key) || [...key].some((char) => char.charCodeAt(0) < 32)),
    )
  )
    return null;
  const clauses = [...new Set(keys)].map((key) =>
    key === EMPTY_GENRE ? 'NOT genre PRESENT' : `genre IS "${key}"`,
  );
  return clauses.length === 1
    ? (clauses[0] ?? null)
    : clauses.map((value) => `(${value})`).join(' OR ');
}
