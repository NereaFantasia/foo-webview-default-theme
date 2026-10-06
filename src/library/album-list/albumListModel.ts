import type { LibraryTrack } from 'foo-webview-sdk';
import type { TableItem } from '../../table/tableItems.ts';
import type { AlbumSection } from '../albumSections.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';
import { isAlbumCollapsed, type ListCollapse, type ListSectionKeys } from './listCollapse.ts';

// 列表形态的条目流：节、专辑分组与曲目行。分两步：先给每首排定行序号（与折叠无关，选中按它记），再按折叠
// 与封面高度摊成表格吃的条目流。

/** 行序号的一段 [start, end)。 */
export interface RowSpan {
  readonly start: number;
  readonly end: number;
}

export interface ListAlbum {
  readonly album: Album;
  readonly key: AlbumKey;
  /** 条目流里分组头的键；艺术家档里同一张专辑在几节里各有一个。 */
  readonly groupKey: string;
  readonly section: string | null;
  readonly span: RowSpan;
  /** 曲目还没取到时为 undefined，按首数画骨架行。 */
  readonly tracks: readonly LibraryTrack[] | undefined;
}

export interface ListSection {
  readonly key: string | null;
  readonly groupKey: string;
  readonly span: RowSpan;
  readonly albums: readonly ListAlbum[];
}

/** 分组头带的数据：节头画节名与张数、首数，专辑分组头画专辑名、专辑艺术家、首数与年份。 */
export type AlbumListGroup =
  | { readonly kind: 'section'; readonly section: ListSection }
  | { readonly kind: 'album'; readonly entry: ListAlbum };

export interface AlbumListOrders {
  /** 平铺档没有节头，专辑分组就是最外层。 */
  readonly headers: boolean;
  readonly sections: readonly ListSection[];
  /** 行序号一共多少，折叠着的也算。 */
  readonly total: number;
  /** 行序号上的曲目；骨架行、越界时为 undefined。 */
  trackAt(order: number): LibraryTrack | undefined;
  /** 行序号落在哪张专辑里。 */
  albumAt(order: number): ListAlbum | undefined;
}

const sectionGroupKey = (key: string | null) => `s${JSON.stringify(key)}`;

/**
 * 按显示顺序给每首排行序号：节内的专辑与节的顺序都已由调用方排好。曲目取到之前按专辑的首数占位，取到之后
 * 按真实的曲目。
 */
export function buildListOrders(
  sections: readonly AlbumSection[],
  headers: boolean,
  tracksOf: (album: Album) => readonly LibraryTrack[] | undefined,
): AlbumListOrders {
  const tracks: (LibraryTrack | undefined)[] = [];
  const owners: ListAlbum[] = [];
  const built = sections.map((section): ListSection => {
    const start = tracks.length;
    const albums = section.albums.map((album): ListAlbum => {
      const key = albumKeyOf(album);
      const own = tracksOf(album);
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
    sections: built,
    total: tracks.length,
    trackAt: (order) => tracks[order],
    albumAt: (order) => owners[order],
  };
}

/** 批量开合要的节与节里的专辑键。 */
export function sectionKeysOf(orders: AlbumListOrders): ListSectionKeys[] {
  return orders.sections.map((section) => ({
    key: section.key,
    albums: section.albums.map((album) => album.key),
  }));
}

/**
 * 摊成条目流：节头、专辑分组头、曲目行。收着的节与专辑不出它下面的条目；展开的专辑行数不到 `fillers` 时在组尾
 * 垫空位，让封面放得下。行的键按专辑里的第几首记，骨架行换成曲目时焦点还在同一行上。
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
