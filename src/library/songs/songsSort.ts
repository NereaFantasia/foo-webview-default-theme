import type { ColumnId } from '../../table/columns/columns.ts';

/**
 * 歌曲页按哪一列排时交给宿主的 Title Formatting 串。宿主按它排 `library.query` 的命中，填专用列表时也用同一串，
 * 表格第 n 行才对得上列表第 n 行。都接同一条稳定化的尾缀（专辑艺术家、年份、专辑、碟号、曲号、标题），同值的
 * 曲目按专辑本来的顺序排；数字补成定宽，按字符串比也是数的大小。只有升序，降序由调用方把结果反过来。
 */
const TAIL =
  "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%";

export const SONGS_SORT: Readonly<Partial<Record<ColumnId, string>>> = {
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
  path: '%path% | $num(%subsong%,4)',
};

export function isSongsSortColumn(value: unknown): value is ColumnId {
  return typeof value === 'string' && Object.hasOwn(SONGS_SORT, value);
}

export function songsSortPattern(column: ColumnId): string {
  return SONGS_SORT[column] ?? '';
}
