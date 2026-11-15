import { conditionQuery, type TrackCondition } from '../../track/trackConditions.ts';
import type { PlaylistRow } from '../playlistRow.ts';

/** 行右键菜单「筛选」能加的字段 */
export type RowConditionField = 'artist' | 'album' | 'genre' | 'year';

export interface ConditionChoice {
  readonly field: RowConditionField;
  readonly condition: TrackCondition;
  /** 能不能加。值为空、带引号或通配符、流派写了好几个时不能：宿主的查询表达不了 */
  readonly usable: boolean;
}

/** 日期里的年份，按第一个四位数认；认不出是空串 */
export function yearOf(date: string): string {
  return /\d{4}/.exec(date)?.[0] ?? '';
}

const artistsOf = (row: PlaylistRow) => (row.artists.length > 0 ? row.artists : [row.artist]);

function choice(field: RowConditionField, value: string, extra = true): ConditionChoice {
  const condition: TrackCondition = { field, operator: 'is', value, end: '' };
  return { field, condition, usable: extra && conditionQuery(condition) !== null };
}

/** 右键那一首能加哪些条件：几位艺人各一项，再是专辑、流派、年份。条件是「等于」，与条件编辑器里加的是同一种 */
export function conditionChoices(row: PlaylistRow): ConditionChoice[] {
  const artists = artistsOf(row).filter((artist) => artist !== '');
  return [
    ...(artists.length > 0 ? artists : ['']).map((artist) => choice('artist', artist)),
    choice('album', row.album),
    // 流派只有拼接串：写了好几个的那一首取不到单个值
    choice('genre', row.genre, !row.genre.includes(', ')),
    choice('year', yearOf(row.date)),
  ];
}
