import type { ColumnId } from '../table/columns/columns.ts';
import type { TableTrack } from '../table/tableItems.ts';
import type { TableSort } from '../table/TrackTableHeader.tsx';
import { trackDisplayTitle } from './trackDisplayTitle.ts';

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
type Compare = (a: TableTrack, b: TableTrack) => number;
const text =
  (value: (track: TableTrack) => string): Compare =>
  (a, b) =>
    COLLATOR.compare(value(a), value(b));
const number =
  (value: (track: TableTrack) => number): Compare =>
  (a, b) =>
    value(a) - value(b);

/** 文字按自然顺序，数字按大小；同值时的分组与稳定次序由页面决定 */
export const TRACK_COMPARE: Readonly<Partial<Record<ColumnId, Compare>>> = {
  number: (a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber,
  title: text(trackDisplayTitle),
  artist: text((track) => track.artist),
  album: text((track) => track.album),
  albumArtist: text((track) => track.albumArtist || track.artist),
  year: text((track) => track.date ?? ''),
  genre: text((track) => track.genre ?? ''),
  rating: number((track) => track.rating),
  duration: number((track) => track.duration),
  added: text((track) => track.added ?? ''),
  playCount: number((track) => track.playCount ?? 0),
  lastPlayed: text((track) => track.lastPlayed ?? ''),
  codec: text((track) => track.codec ?? ''),
  bitrate: number((track) => track.bitrate ?? 0),
  sampleRate: number((track) => track.sampleRate ?? 0),
  channels: number((track) => track.channels ?? 0),
  fileSize: number((track) => track.fileSize ?? 0),
  path: (a, b) => COLLATOR.compare(a.absolutePath, b.absolutePath) || a.subsong - b.subsong,
};

/** 值越大越有用的列：年份、评分，以及添加时间、播放次数、最近播放这类统计，换到它们时从大的、新的在前起 */
const DESCENDING_FIRST: ReadonlySet<ColumnId> = new Set([
  'year',
  'rating',
  'added',
  'playCount',
  'lastPlayed',
]);

/** 换到这一列时的缺省方向，真为降序 */
export function startsDescending(column: ColumnId): boolean {
  return DESCENDING_FIRST.has(column);
}

/** 点列头：同一列反向；换到另一列按它的缺省方向起 */
export function nextTrackSort(
  now: TableSort | null,
  column: ColumnId,
): Pick<TableSort, 'column' | 'descending'> {
  return {
    column,
    descending: now?.column === column ? !now.descending : startsDescending(column),
  };
}

/**
 * 不分组时把各组连起来的曲目整体排序：入参已是各组连接后的次序，同值保持这个次序，升降序都一样。
 * 序号列在平铺里只有「组内的曲序」可言，不跨组混排：升序保持入参次序，降序整份倒过来。没有可排的列时原样返回
 */
export function sortFlatTracks<T extends TableTrack>(
  tracks: readonly T[],
  sort: TableSort | null,
): T[] {
  if (!sort) return [...tracks];
  if (sort.column === 'number') return sort.descending ? [...tracks].reverse() : [...tracks];
  const by = TRACK_COMPARE[sort.column];
  if (!by) return [...tracks];
  const sign = sort.descending ? -1 : 1;
  return [...tracks].sort((a, b) => by(a, b) * sign);
}

/**
 * 曲目按列排序时交给宿主的 Title Formatting 串。宿主按它排 `library.query` 的命中，填专用列表时也用同一串，
 * 表格第 n 行才对得上列表第 n 行。都接同一条稳定化的尾缀（专辑艺术家、年份、专辑、碟号、曲号、标题），同值的
 * 曲目按专辑本来的顺序排；数字补成定宽，按字符串比也是数的大小。只有升序，降序由调用方把结果反过来
 */
const TAIL =
  "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%";

export const TRACK_SORT: Readonly<Partial<Record<ColumnId, string>>> = {
  number: `$num(%tracknumber%,4) | ${TAIL}`,
  title: `%title% | ${TAIL}`,
  artist: `%artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%`,
  album: '%album% | %album artist% | %discnumber% | %tracknumber% | %title%',
  albumArtist: TAIL,
  year: `%date% | ${TAIL}`,
  genre: `%genre% | ${TAIL}`,
  rating: `$num($if2(%rating%,0),1) | ${TAIL}`,
  duration: `$num(%length_seconds%,6) | ${TAIL}`,
  added: `%added% | ${TAIL}`,
  playCount: `$num($if2(%play_count%,0),6) | ${TAIL}`,
  lastPlayed: `%last_played% | ${TAIL}`,
  codec: `%codec% | ${TAIL}`,
  bitrate: `$num(%bitrate%,5) | ${TAIL}`,
  sampleRate: `$num(%samplerate%,8) | ${TAIL}`,
  channels: `$num($info(channels),3) | ${TAIL}`,
  fileSize: `$num(%filesize%,16) | ${TAIL}`,
  path: '%path% | $num(%subsong%,4)',
};

/** 这几列要 foo_playcount 的统计：显示时才取数，没装时排序菜单里不给选 */
export const TRACK_STATS_COLUMNS: ReadonlySet<ColumnId> = new Set([
  'added',
  'playCount',
  'lastPlayed',
]);

export function isTrackSortColumn(value: unknown): value is ColumnId {
  return typeof value === 'string' && Object.hasOwn(TRACK_SORT, value);
}

export function trackSortPattern(column: ColumnId): string {
  return TRACK_SORT[column] ?? '';
}
