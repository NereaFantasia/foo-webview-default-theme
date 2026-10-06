import type { LibraryTrack } from 'foo-webview-sdk';
import type { TableItem } from '../../table/tableItems.ts';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import type { ArtistDetail } from './artistDetail.ts';

export interface ArtistGroup {
  readonly key: string;
  readonly section: 'own' | 'guest';
  readonly album?: Album;
  readonly start: number;
  readonly end: number;
}
export const ARTIST_ROW_HEIGHT = 40;
export const ARTIST_GROUP_HEIGHT = 36;

export function artistGroups(detail: ArtistDetail | null) {
  const tracks: LibraryTrack[] = [];
  const groups: ArtistGroup[] = [];
  if (detail)
    for (const section of ['own', 'guest'] as const) {
      const albums = detail[section];
      if (!albums.length) continue;
      const start = tracks.length;
      const children: ArtistGroup[] = [];
      for (const group of albums) {
        const first = tracks.length;
        tracks.push(...group.tracks);
        children.push({
          key: `${section}:${albumKeyOf(group.album)}`,
          section,
          album: group.album,
          start: first,
          end: tracks.length,
        });
      }
      groups.push({ key: section, section, start, end: tracks.length }, ...children);
    }
  return { tracks, groups };
}

export function artistTableItems(
  tracks: readonly LibraryTrack[],
  groups: readonly ArtistGroup[],
  closed: ReadonlySet<string>,
  coverHeight: number,
): readonly TableItem<ArtistGroup>[] {
  const items: TableItem<ArtistGroup>[] = [];
  for (const group of groups) {
    if (group.album && closed.has(group.section)) continue;
    const collapsed = closed.has(group.key);
    items.push({
      kind: 'group',
      key: group.key,
      data: group,
      level: group.album ? 1 : 0,
      collapsed,
    });
    if (!group.album || collapsed) continue;
    for (let order = group.start; order < group.end; order += 1) {
      const track = tracks[order];
      if (track)
        items.push({ kind: 'row', key: `${group.key}:${order}:${track.handle}`, order, track });
    }
    for (
      let height = (group.end - group.start) * ARTIST_ROW_HEIGHT;
      height < coverHeight;
      height += ARTIST_ROW_HEIGHT
    )
      items.push({ kind: 'filler', key: `${group.key}:space:${height}` });
  }
  return items;
}
