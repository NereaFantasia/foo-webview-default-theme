import type { LibraryTrack } from 'foo-webview-sdk';
import type { TableItem } from '../../table/tableItems.ts';
import { albumKeyOf, trackAlbumKeyOf, type Album } from '../../host/libraryContract.ts';
import type { GenreGrouping } from './genresPrefs.ts';

export const GENRE_ROW_HEIGHT = 40;
export const GENRE_GROUP_HEIGHT = 36;
const ALBUM_SORT = '%album% | %album artist% | %discnumber% | %tracknumber% | %title%';
export const GENRES_SORT: Readonly<Record<GenreGrouping, string>> = {
  album: ALBUM_SORT,
  albumDisc: ALBUM_SORT,
  albumArtist: `%album artist% | ${ALBUM_SORT}`,
  artist: `%artist% | ${ALBUM_SORT}`,
  directory: `$directory_path(%path%) | ${ALBUM_SORT}`,
  none: '%title% | %album artist% | %album% | %discnumber% | %tracknumber%',
};

export interface GenreGroup {
  readonly key: string;
  readonly label: string;
  readonly album: Album | undefined;
  readonly start: number;
  readonly end: number;
  readonly disc: number | null;
}

function groupValue(track: LibraryTrack, mode: GenreGrouping): string {
  if (mode === 'albumArtist') return track.albumArtist || track.artist;
  if (mode === 'artist') return track.artist;
  if (mode === 'directory') return track.path.replace(/[\\/][^\\/]*$/, '');
  return trackAlbumKeyOf(track) ?? '';
}

/** 只把相邻的同组行合在一起，不重排宿主返回的行号。折叠改变显示位置，不改变起播位置。 */
export function buildGenreGroups(
  tracks: readonly LibraryTrack[],
  mode: GenreGrouping,
  albums: readonly Album[],
): readonly GenreGroup[] {
  if (mode === 'none') return [];
  const index = new Map(albums.map((album) => [albumKeyOf(album), album]));
  const result: GenreGroup[] = [];
  let start = 0;
  while (start < tracks.length) {
    const first = tracks[start];
    if (!first) break;
    const value = groupValue(first, mode);
    let end = start + 1;
    while (end < tracks.length && tracks[end] && groupValue(tracks[end], mode) === value) end += 1;
    const key = JSON.stringify([mode, value, first.handle]);
    const albumKey = trackAlbumKeyOf(first);
    result.push({
      key,
      label: mode === 'album' || mode === 'albumDisc' ? first.album : value,
      album:
        (mode === 'album' || mode === 'albumDisc') && albumKey ? index.get(albumKey) : undefined,
      start,
      end,
      disc: null,
    });
    if (mode === 'albumDisc') {
      let from = start;
      while (from < end) {
        const disc = tracks[from]?.discNumber ?? 0;
        let to = from + 1;
        while (to < end && tracks[to]?.discNumber === disc) to += 1;
        result.push({
          key: JSON.stringify([key, disc, from]),
          label: String(disc),
          album: undefined,
          start: from,
          end: to,
          disc,
        });
        from = to;
      }
    }
    start = end;
  }
  return result;
}

export function genreTableItems(
  tracks: readonly LibraryTrack[],
  groups: readonly GenreGroup[],
  closed: ReadonlySet<string>,
  coverHeight: number,
): readonly TableItem<GenreGroup>[] {
  const items: TableItem<GenreGroup>[] = [];
  const row = (order: number) => {
    const track = tracks[order];
    if (track) items.push({ kind: 'row', key: track.handle, order, track });
  };
  if (groups.length === 0) {
    tracks.forEach((_, order) => row(order));
    return items;
  }
  let cursor = 0;
  while (cursor < groups.length) {
    const group = groups[cursor++];
    if (!group || group.disc !== null) continue;
    const discs: GenreGroup[] = [];
    while (cursor < groups.length) {
      const disc = groups[cursor];
      if (!disc || disc.disc === null) break;
      discs.push(disc);
      cursor += 1;
    }
    const collapsed = closed.has(group.key);
    items.push({ kind: 'group', key: group.key, level: 0, collapsed, data: group });
    if (collapsed) continue;
    let visible = 0;
    if (discs.length > 0) {
      for (const disc of discs) {
        items.push({
          kind: 'group',
          key: disc.key,
          level: 1,
          collapsed: closed.has(disc.key),
          data: disc,
        });
        visible += GENRE_GROUP_HEIGHT;
        if (!closed.has(disc.key))
          for (let at = disc.start; at < disc.end; at += 1) {
            row(at);
            visible += GENRE_ROW_HEIGHT;
          }
      }
    } else
      for (let at = group.start; at < group.end; at += 1) {
        row(at);
        visible += GENRE_ROW_HEIGHT;
      }
    if (group.album)
      for (let at = visible; at < coverHeight; at += GENRE_ROW_HEIGHT)
        items.push({ kind: 'filler', key: `${group.key}:${at}` });
  }
  return items;
}
