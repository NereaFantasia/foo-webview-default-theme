import { COLUMN_IDS, type ColumnId } from '../table/columns/columns.ts';

/**
 * 排序用的 Title Formatting 串，以及按什么分组。
 *
 * 三个消费方共用这一份：列头点击排序、列头菜单的排序子菜单、切分组依据时对宿主列表的重排。
 * 分开抄会漂——同一个「按艺术家」在三处给出不同的串时，界面上看不出来，只有顺序不一样。
 *
 * 串取自 foobox 的 `jsplaylist.js`。它们都带同一条稳定化尾缀
 * `%album artist% → $if(%album%,%date%,'9999') → %album% → %discnumber% → %tracknumber% → %title%`
 * （`'9999'` 把缺专辑的曲目排到末尾），`album` 一档除外。
 *
 * 这里只有串与 `id`，各项的文案由画菜单的一层按 `id` 取。
 */

const TAIL = "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %title%";
const TAIL_WITH_TRACK =
  "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%";

export const SORT_ALBUM_ARTIST = `%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%`;
export const SORT_ARTIST = `%artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%`;
export const SORT_ALBUM = '%album% | %discnumber% | %tracknumber% | %title%';
export const SORT_TRACK_NUMBER = `%tracknumber% | ${TAIL}`;
export const SORT_TITLE = `%title% | %album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber%`;
export const SORT_PATH = `$directory_path(%path%) | ${TAIL_WITH_TRACK}`;
export const SORT_DATE =
  '%date% | %album artist% | %album% | %discnumber% | %tracknumber% | %title%';
export const SORT_GENRE = `%genre% | ${TAIL_WITH_TRACK}`;
export const SORT_RATING = `%rating% | ${TAIL_WITH_TRACK}`;
export const SORT_BITRATE = `%bitrate% | ${TAIL_WITH_TRACK}`;
export const SORT_MODIFIED = `%last_modified% | ${TAIL_WITH_TRACK}`;
export const SORT_PLAY_COUNT = `$if2(%play_count%,0) | ${TAIL_WITH_TRACK}`;
export const SORT_CODEC = `%codec% | ${TAIL_WITH_TRACK}`;
/** 时长这一档 foobox 没有，是本主题的时长列要用的。 */
export const SORT_DURATION = `$if2(%length%,' 0:00') | ${TAIL_WITH_TRACK}`;

export type SortChoiceId =
  | 'albumArtist'
  | 'artist'
  | 'album'
  | 'trackNumber'
  | 'title'
  | 'path'
  | 'date'
  | 'genre'
  | 'rating'
  | 'bitrate'
  | 'modified'
  | 'playCount'
  | 'codec';

/** 排序子菜单里的一项。 */
export interface SortChoice {
  readonly id: SortChoiceId;
  readonly pattern: string;
}

/** 排序子菜单的十三个排序键，次序照 foobox 列头菜单（`WSHheaderbar.js`）。 */
export const SORT_CHOICES: readonly SortChoice[] = [
  { id: 'albumArtist', pattern: SORT_ALBUM_ARTIST },
  { id: 'artist', pattern: SORT_ARTIST },
  { id: 'album', pattern: SORT_ALBUM },
  { id: 'trackNumber', pattern: SORT_TRACK_NUMBER },
  { id: 'title', pattern: SORT_TITLE },
  { id: 'path', pattern: SORT_PATH },
  { id: 'date', pattern: SORT_DATE },
  { id: 'genre', pattern: SORT_GENRE },
  { id: 'rating', pattern: SORT_RATING },
  { id: 'bitrate', pattern: SORT_BITRATE },
  { id: 'modified', pattern: SORT_MODIFIED },
  { id: 'playCount', pattern: SORT_PLAY_COUNT },
  { id: 'codec', pattern: SORT_CODEC },
];

/** 单击列头时按哪个串排宿主列表；封面与状态列没有能排的字段。 */
export const COLUMN_SORT: Readonly<Partial<Record<ColumnId, string>>> = {
  number: SORT_TRACK_NUMBER,
  title: SORT_TITLE,
  artist: SORT_ARTIST,
  rating: SORT_RATING,
  duration: SORT_DURATION,
  album: SORT_ALBUM,
};

/** 反查排序串对应的列；排序子菜单里那些不对应任何一列的串给 null。 */
export function columnOfSortKey(pattern: string): ColumnId | null {
  return COLUMN_IDS.find((id) => COLUMN_SORT[id] === pattern) ?? null;
}

export type GroupModeId =
  'albumSimple' | 'albumArtistAlbumDisc' | 'albumArtist' | 'artist' | 'genre' | 'directory';

/**
 * 分组依据的六档，照 foobox 的默认表（`WSHplaylist.js`）。
 *
 * `patterns` 是发给 `playlist.getGroupRuns` 的一级与可选二级键；`sort` 是切到这一档时
 * 对宿主列表做的重排。**必须重排**：游程只认相邻曲目，顺序不对就会碎成一堆单曲组。
 *
 * 模式串里不能出现本地化文案——折叠集合与封面缓存都以组键识别分组，翻译一变就全对不上。
 */
export interface GroupMode {
  readonly id: GroupModeId;
  readonly patterns: readonly string[];
  readonly sort: string;
}

export const GROUP_MODES: readonly GroupMode[] = [
  { id: 'albumSimple', patterns: ['%album%'], sort: SORT_ALBUM },
  {
    // 默认档：一级按「专辑 | 专辑艺术家」，二级按碟号。专辑在前，行数据未到时组头能直接显示组键。
    id: 'albumArtistAlbumDisc',
    patterns: ['%album% | %album artist%', '$if2(%discnumber%,)'],
    sort: SORT_ALBUM_ARTIST,
  },
  { id: 'albumArtist', patterns: ['%album artist%'], sort: SORT_ALBUM_ARTIST },
  { id: 'artist', patterns: ['%artist%'], sort: SORT_ARTIST },
  { id: 'genre', patterns: ['%genre%'], sort: SORT_GENRE },
  { id: 'directory', patterns: ['$directory_path(%path%)'], sort: SORT_PATH },
];

/** 默认档在 `GROUP_MODES` 里的下标：「专辑 | 专辑艺术家」加碟号两级。 */
export const DEFAULT_GROUP_MODE = 1;
