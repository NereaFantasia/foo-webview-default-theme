import type { LibraryTrack } from 'foo-webview-sdk';
import type { TableItem } from '../../table/tableItems.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { sortFlatTracks, TRACK_COMPARE } from '../../track/trackSort.ts';
import type { AlbumSection } from '../albumSections.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';
import { PLAY_LIMIT } from '../../playback/libraryView.ts';
import { isAlbumCollapsed, type ListCollapse, type ListSectionKeys } from './listCollapse.ts';

// 列表形态的条目流：节、专辑分组与曲目行。分两步：先给每首排定行序号（与折叠无关，选中按它记），再按折叠
// 与封面高度摊成表格吃的条目流

/** 行序号的一段 [start, end) */
export interface RowSpan {
  readonly start: number;
  readonly end: number;
}

export interface ListAlbum {
  readonly album: Album;
  readonly key: AlbumKey;
  /** 条目流里分组头的键；艺术家档里同一张专辑在几节里各有一个 */
  readonly groupKey: string;
  readonly section: string | null;
  readonly span: RowSpan;
  /** 曲目还没取到时为 undefined，按首数画骨架行 */
  readonly tracks: readonly LibraryTrack[] | undefined;
}

export interface ListSection {
  readonly key: string | null;
  readonly groupKey: string;
  readonly span: RowSpan;
  readonly albums: readonly ListAlbum[];
}

/** 分组头带的数据：节头画节名与张数、首数，专辑分组头画专辑名、专辑艺术家、首数与年份 */
export type AlbumListGroup =
  | { readonly kind: 'section'; readonly section: ListSection }
  | { readonly kind: 'album'; readonly entry: ListAlbum };

export interface AlbumListOrders {
  /** 平铺档没有节头，专辑分组就是最外层 */
  readonly headers: boolean;
  /**
   * 不按专辑分组：节下面直接是曲目行。节里的 `albums` 只记归属（艺术家档的重复、节头的张数），`span` 为空，
   * 行序号归节
   */
  readonly flat: boolean;
  readonly sections: readonly ListSection[];
  /** 行序号一共多少，折叠着的也算 */
  readonly total: number;
  /** 行序号上的曲目；骨架行、越界时为 undefined */
  trackAt(order: number): LibraryTrack | undefined;
  /** 行序号落在哪张专辑里 */
  albumAt(order: number): ListAlbum | undefined;
}

const sectionGroupKey = (key: string | null) => `s${JSON.stringify(key)}`;

/** 只重排一张专辑内的曲目；字段同值时保留原曲序，升降序都一样 */
export function sortListTracks<T extends LibraryTrack>(
  tracks: readonly T[],
  sort?: TableSort,
): readonly T[] {
  const compare = sort ? TRACK_COMPARE[sort.column] : undefined;
  return compare ? [...tracks].sort((a, b) => compare(a, b) * (sort?.descending ? -1 : 1)) : tracks;
}

/**
 * 按显示顺序给每首排行序号：节内的专辑与节的顺序都已由调用方排好。曲目取到之前按专辑的首数占位，取到之后
 * 按真实的曲目
 */
export function buildListOrders(
  sections: readonly AlbumSection[],
  headers: boolean,
  tracksOf: (album: Album) => readonly LibraryTrack[] | undefined,
  sort?: TableSort,
  flat = false,
): AlbumListOrders {
  if (flat) return buildFlatOrders(sections, headers, tracksOf, sort);
  const tracks: (LibraryTrack | undefined)[] = [];
  const owners: ListAlbum[] = [];
  const built = sections.map((section): ListSection => {
    const start = tracks.length;
    const albums = section.albums.map((album): ListAlbum => {
      const key = albumKeyOf(album);
      const source = tracksOf(album);
      const own = source ? sortListTracks(source, sort) : undefined;
      const from = tracks.length;
      const count = own ? own.length : album.trackCount;
      const entry: ListAlbum = {
        album,
        key,
        groupKey: `a${JSON.stringify(section.key)}${key}`,
        section: section.key,
        span: { start: from, end: from + count },
        tracks: own,
      };
      for (let at = 0; at < count; at += 1) {
        tracks.push(own?.[at]);
        owners.push(entry);
      }
      return entry;
    });
    const span = { start, end: tracks.length };
    return { key: section.key, groupKey: sectionGroupKey(section.key), span, albums };
  });
  return {
    headers,
    flat: false,
    sections: built,
    total: tracks.length,
    trackAt: (order) => tracks[order],
    albumAt: (order) => owners[order],
  };
}

/**
 * 不按专辑分组的行序号：每节里各张专辑的曲目按专辑次序连起来，再整体按列排。节里有专辑的曲目还没取到时，
 * 这一节先按各张的首数占骨架行，不假装排过
 */
function buildFlatOrders(
  sections: readonly AlbumSection[],
  headers: boolean,
  tracksOf: (album: Album) => readonly LibraryTrack[] | undefined,
  sort?: TableSort,
): AlbumListOrders {
  const tracks: (LibraryTrack | undefined)[] = [];
  const owners: ListAlbum[] = [];
  const built = sections.map((section): ListSection => {
    const start = tracks.length;
    const entries = section.albums.map((album): ListAlbum => {
      const key = albumKeyOf(album);
      const own = tracksOf(album);
      return {
        album,
        key,
        groupKey: `a${JSON.stringify(section.key)}${key}`,
        section: section.key,
        span: { start, end: start },
        tracks: own,
      };
    });
    if (entries.every((entry) => entry.tracks)) {
      const ownerOf = new Map<string, ListAlbum>();
      for (const entry of entries)
        for (const track of entry.tracks ?? []) ownerOf.set(track.handle, entry);
      for (const track of sortFlatTracks(
        entries.flatMap((entry) => entry.tracks ?? []),
        sort ?? null,
      )) {
        tracks.push(track);
        const owner = ownerOf.get(track.handle);
        if (owner) owners.push(owner);
      }
    } else {
      for (const entry of entries) {
        for (let at = 0; at < entry.album.trackCount; at += 1) {
          tracks.push(undefined);
          owners.push(entry);
        }
      }
    }
    const span = { start, end: tracks.length };
    return { key: section.key, groupKey: sectionGroupKey(section.key), span, albums: entries };
  });
  return {
    headers,
    flat: true,
    sections: built,
    total: tracks.length,
    trackAt: (order) => tracks[order],
    albumAt: (order) => owners[order],
  };
}

/**
 * 不按专辑分组时双击一行的起播：整份行（折叠着的节也算）连成一份，从点中的那一行起。行里有曲目还没取到时
 * 为 null，不播半份；超过 `PLAY_LIMIT` 首时只交点中那一行前后各一半
 */
export function flatPlayQueue(
  orders: AlbumListOrders,
  order: number,
): { readonly tracks: readonly LibraryTrack[]; readonly at: number } | null {
  const all: LibraryTrack[] = [];
  for (let at = 0; at < orders.total; at += 1) {
    const track = orders.trackAt(at);
    if (!track) return null;
    all.push(track);
  }
  if (order < 0 || order >= all.length) return null;
  const from = Math.max(0, Math.min(order - Math.floor(PLAY_LIMIT / 2), all.length - PLAY_LIMIT));
  return { tracks: all.slice(from, from + PLAY_LIMIT), at: order - from };
}

/** 已取到的曲目所在的专辑，按 handle 查：序号格要碟数，不分专辑时每行的缩略图要封面。同一张专辑出现在几节里时取同一张 */
export function albumsByHandle(orders: AlbumListOrders): ReadonlyMap<string, Album> {
  const owners = new Map<string, Album>();
  for (const section of orders.sections) {
    for (const entry of section.albums) {
      for (const track of entry.tracks ?? []) owners.set(track.handle, entry.album);
    }
  }
  return owners;
}

/** 批量开合要的节与节里的专辑键 */
export function sectionKeysOf(orders: AlbumListOrders): ListSectionKeys[] {
  return orders.sections.map((section) => ({
    key: section.key,
    albums: section.albums.map((album) => album.key),
  }));
}

/**
 * 摊成条目流：节头、专辑分组头、曲目行。收着的节与专辑不出它下面的条目；展开的专辑行数不到 `fillers` 时在组尾
 * 垫空位，让封面放得下。行的键按专辑里的第几首记，骨架行换成曲目时焦点还在同一行上
 */
export function buildListItems(
  orders: AlbumListOrders,
  collapse: ListCollapse,
  fillers: number,
): TableItem<AlbumListGroup>[] {
  const items: TableItem<AlbumListGroup>[] = [];
  const level = orders.headers ? 1 : 0;
  for (const section of orders.sections) {
    if (orders.headers) {
      const collapsed = collapse.sections.has(section.key);
      const data = { kind: 'section', section } as const;
      items.push({ kind: 'group', key: section.groupKey, level: 0, collapsed, data });
      if (collapsed) continue;
    }
    if (orders.flat) {
      const { start, end } = section.span;
      for (let order = start; order < end; order += 1) {
        const track = orders.trackAt(order);
        items.push({ kind: 'row', key: `${section.groupKey}#${order - start}`, order, track });
      }
      continue;
    }
    for (const entry of section.albums) {
      const collapsed = isAlbumCollapsed(collapse, entry.key);
      const data = { kind: 'album', entry } as const;
      items.push({ kind: 'group', key: entry.groupKey, level, collapsed, data });
      if (collapsed) continue;
      const { start, end } = entry.span;
      for (let order = start; order < end; order += 1) {
        const track = orders.trackAt(order);
        items.push({ kind: 'row', key: `${entry.groupKey}#${order - start}`, order, track });
      }
      for (let at = end - start; at < fillers; at += 1) {
        items.push({ kind: 'filler', key: `${entry.groupKey}~${at}` });
      }
    }
  }
  return items;
}
