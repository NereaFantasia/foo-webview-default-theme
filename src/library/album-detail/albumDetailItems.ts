import type { LibraryTrack } from 'foo-webview-sdk';
import { discTrackText, trackNumberText } from '../../table/cellText.ts';
import type { ColumnId } from '../../table/columns/columns.ts';
import type { TableItem, TableTrack } from '../../table/tableItems.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';

/** 详情页曲目表的分组头只有一种：多碟专辑里的一张碟。 */
export interface DiscGroup {
  readonly disc: number;
  /** 这张碟在显示顺序里的曲目，给右键与双击分组头用。 */
  readonly tracks: readonly LibraryTrack[];
}

export type DetailItem = TableItem<DiscGroup>;

export interface DetailRows {
  readonly items: readonly DetailItem[];
  /** 显示顺序里的曲目，下标就是行序号。 */
  readonly tracks: readonly LibraryTrack[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 一首此刻的星级：行里的是取回时的值，页面写过评分之后要问评分服务。 */
export type RatingOf = (track: LibraryTrack) => number;

/** 按列比两首；比不出的留给调用方按原顺序（碟、曲、标题）排，排序因此是稳定的。 */
function compareBy(column: ColumnId, a: LibraryTrack, b: LibraryTrack, ratingOf: RatingOf): number {
  switch (column) {
    case 'title':
      return collator.compare(a.title, b.title);
    case 'artist':
      return collator.compare(a.artist, b.artist);
    case 'rating':
      return ratingOf(a) - ratingOf(b);
    case 'duration':
      return a.duration - b.duration;
    default:
      return 0;
  }
}

/** 排序工具里能选的字段，序号列代表专辑顺序（碟、曲、标题）。与列头排序共用同一份 `TableSort`。 */
export const DETAIL_SORT_FIELDS: readonly ColumnId[] = [
  'number',
  'title',
  'artist',
  'rating',
  'duration',
];

export function detailSortField(sort: TableSort | null): ColumnId {
  return sort?.column ?? 'number';
}

/** 专辑顺序升序是缺省，存成 null，列头不出箭头；其余照给的字段与方向。 */
export function detailSort(column: ColumnId, descending: boolean): TableSort | null {
  return column === 'number' && !descending ? null : { column, descending };
}

/**
 * 详情页的列头排序：点一列按它升序，再点同一列反向。# 是专辑顺序，缺省就是它的升序，所以在缺省时点 #
 * 直接反向；从别的列点回 # 回到缺省。封面、状态列不排。
 */
export function nextDetailSort(now: TableSort | null, column: ColumnId): TableSort | null {
  const descending = now === null ? column === 'number' : now.column === column && !now.descending;
  return detailSort(column, descending);
}

/** 页内查找：不分大小写，按空白拆词，每个词都要出现在标题或艺人里；没有词时不筛。 */
export function filterDetailTracks(
  tracks: readonly LibraryTrack[],
  query: string,
): readonly LibraryTrack[] {
  const words = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return tracks;
  return tracks.filter((track) => {
    const text = `${track.title}\n${track.artist}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * 条目流。`tracks` 已按碟、曲、标题排好。专辑顺序（升降都算）下多碟专辑每张碟前放一个分组头，不能折叠；按别的
 * 列排时平铺，不分碟。`skeleton` 大于 0 时曲目还没到，画这么多行骨架。按等级排时星级按 `ratingOf` 此刻答的算，
 * 之后再改了评分不跟着重排，免得行在指针底下挪走。
 */
export function buildDetailRows(
  tracks: readonly LibraryTrack[],
  sort: TableSort | null,
  discCount: number,
  skeleton = 0,
  ratingOf: RatingOf = (track) => track.rating,
): DetailRows {
  if (tracks.length === 0) {
    const items = Array.from({ length: skeleton }, (_, order): DetailItem => ({
      kind: 'row',
      key: `s${order}`,
      order,
      track: undefined,
    }));
    return { items, tracks: [] };
  }
  const albumOrder = sort === null || sort.column === 'number';
  const shown = albumOrder
    ? sort?.descending
      ? [...tracks].reverse()
      : [...tracks]
    : tracks
        .map((track, at) => ({ track, at }))
        .sort((a, b) => {
          const order = compareBy(sort.column, a.track, b.track, ratingOf);
          return (sort.descending ? -order : order) || a.at - b.at;
        })
        .map(({ track }) => track);
  const items: DetailItem[] = [];
  const grouped = albumOrder && discCount > 1;
  shown.forEach((track, order) => {
    if (grouped && shown[order - 1]?.discNumber !== track.discNumber) {
      const disc = track.discNumber;
      const discTracks = shown.filter((other) => other.discNumber === disc);
      const data: DiscGroup = { disc, tracks: discTracks };
      items.push({ kind: 'group', key: `d${disc}`, level: 0, collapsed: false, data });
    }
    items.push({ kind: 'row', key: `t${track.handle}`, order, track });
  });
  return { items, tracks: shown };
}

/**
 * 序号格：分碟显示或单碟专辑只写曲号；多碟专辑按别的列排、不分碟时写「碟.曲」，免得几张碟的同号分不开。
 */
export function detailNumberText(
  sort: TableSort | null,
  discCount: number,
): (track: TableTrack) => string {
  if (sort === null || sort.column === 'number' || discCount <= 1) return trackNumberText;
  return (track) => discTrackText(track, discCount);
}
