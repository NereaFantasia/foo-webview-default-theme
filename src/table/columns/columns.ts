import type { MessageKey } from '../../i18n/en.ts';

// 曲目表格的列：定义、宽度的写法与列序的纯函数。状态与落盘在 `columnsModel.ts`。

export type ColumnId =
  | 'cover'
  | 'status'
  | 'number'
  | 'title'
  | 'artist'
  | 'rating'
  | 'duration'
  | 'album'
  | 'albumArtist'
  | 'year'
  | 'genre'
  | 'added'
  | 'playCount'
  | 'lastPlayed'
  | 'codec'
  | 'bitrate'
  | 'path'
  | 'art';

export interface ColumnDef {
  readonly id: ColumnId;
  /** 列头菜单、拖动时的幽灵与读屏用的列名。 */
  readonly label: MessageKey;
  /** 列头上写的字；null 的列头不写字。 */
  readonly heading: MessageKey | null;
  /** 数字列：右对齐、等宽数字。 */
  readonly numeric: boolean;
  /** 列头能不能点着排序；真排不排由表格的调用方决定。 */
  readonly sortable: boolean;
  /** 宽度按内容定死：右缘不出分隔条，别的分隔条拖动时也不从它这里借宽度。 */
  readonly fixed: boolean;
  /** 宽度存 fr 权重、分掉剩下的空间；其余列存像素。 */
  readonly flexible: boolean;
}

/** 多数列的样子：列头写列名、能排序、存像素宽；与它不同的几项逐列写明。 */
function column(id: ColumnId, label: MessageKey, traits: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id,
    label,
    heading: label,
    numeric: false,
    sortable: true,
    fixed: false,
    flexible: false,
    ...traits,
  };
}

/**
 * 列表，顺序就是存档里列宽的下标，显示换位不改这张表。下标与已有的存档对齐：前七列的下标与七项的旧存档
 * 一一对应，专辑列是 7，专辑艺术家到路径是 8 到 16，缩略图是 17；新列只能加在末尾，存档按项数认版本
 * （`STORED_COUNTS`）。
 */
export const COLUMNS: readonly ColumnDef[] = [
  column('cover', 'table.cover', { sortable: false }),
  // 状态列只画选中的记号，没有能排的字段。
  column('status', 'table.status', { heading: null, sortable: false, fixed: true }),
  column('number', 'table.number', { heading: 'table.numberHeading', numeric: true }),
  column('title', 'table.title', { flexible: true }),
  column('artist', 'table.artist', { flexible: true }),
  // 等级列按五颗星的内容设宽。
  column('rating', 'table.rating', { fixed: true }),
  column('duration', 'table.duration', { numeric: true }),
  column('album', 'table.album', { flexible: true }),
  column('albumArtist', 'table.albumArtist', { flexible: true }),
  column('year', 'table.year', { numeric: true }),
  column('genre', 'table.genre'),
  // 两种时间都只写到日，等宽数字右对齐，上下行对得齐。
  column('added', 'table.added', { numeric: true }),
  column('playCount', 'table.playCount', { numeric: true }),
  column('lastPlayed', 'table.lastPlayed', { numeric: true }),
  column('codec', 'table.codec'),
  column('bitrate', 'table.bitrate', { numeric: true }),
  column('path', 'table.path', { flexible: true }),
  // 缩略图列每行一张小封面，宽度跟着行高走（见 `columnTrack`），存档里的那一项不用。
  column('art', 'table.art', { heading: null, sortable: false, fixed: true }),
];

/**
 * 各版存档的列数。七项的还没有专辑列，八项的还没有专辑艺术家以后的十列；读回时缺的列补上缺省宽、记成藏着，
 * 存档时还没有这些列的表上不会突然多出列来。
 */
export const STORED_COUNTS: readonly number[] = [7, 8, COLUMNS.length];

export const COLUMN_IDS: readonly ColumnId[] = COLUMNS.map((column) => column.id);

const BY_ID = new Map(COLUMNS.map((column) => [column.id, column]));

export function columnDef(id: ColumnId): ColumnDef {
  const column = BY_ID.get(id);
  if (!column) throw new Error(`没有这一列：${id}`);
  return column;
}

/** 这一列在存档列宽里的下标。 */
export function columnIndex(id: ColumnId): number {
  return COLUMN_IDS.indexOf(id);
}

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === 'string' && COLUMN_IDS.some((id) => id === value);
}

/**
 * 缺省的显示顺序：缩略图紧贴标题左边，专辑紧跟艺术家，后来加的几列排在专辑与等级之间，等级与时长留在最右。
 * 封面恒在最左，不参与换位。
 */
export const DEFAULT_ORDER: readonly ColumnId[] = [
  'cover',
  'status',
  'number',
  'art',
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'genre',
  'added',
  'playCount',
  'lastPlayed',
  'codec',
  'bitrate',
  'path',
  'rating',
  'duration',
];

/** 标题列不能藏：别的列全藏掉时表里还得有内容。 */
export const REQUIRED_COLUMN: ColumnId = 'title';

/** 按 `COLUMNS` 的下标排，长度恒为 `COLUMNS.length`；fr 列是权重，其余是 CSS 像素。只经 `toWidths` 造。 */
export type ColumnWidths = readonly number[];

/** 缺省列宽：标题与艺术家按 2 : 1 分剩下的空间。 */
export const DEFAULT_WIDTHS: ColumnWidths = [
  120, 24, 52, 2, 1, 88, 60, 1, 1, 52, 96, 96, 60, 96, 64, 72, 2, 48,
];

/** 按 `COLUMNS` 的顺序收成全部列的项数；多的丢掉，缺的补 0。 */
export function toWidths(values: readonly number[]): ColumnWidths {
  return COLUMNS.map((_, at) => values[at] ?? 0);
}

/** 拖分隔条时普通列的最窄宽度，CSS 像素；封面列可以拖到 0。 */
export const MIN_WIDTH = 32;

/** 表格容器不宽于这么多 CSS 像素时是窄档，只留 `NARROW_COLUMNS` 里的列。 */
export const NARROW_WIDTH = 520;
export const NARROW_COLUMNS: ReadonlySet<ColumnId> = new Set(['number', 'title', 'duration']);

export function widthOf(widths: ColumnWidths, id: ColumnId): number {
  return widths[columnIndex(id)] ?? 0;
}

export function withWidth(widths: ColumnWidths, id: ColumnId, width: number): ColumnWidths {
  const next = [...widths];
  next[columnIndex(id)] = width;
  return toWidths(next);
}

/** 缩略图列的宽：表格按行高给的缩略图边长（`--table-art-size`），左右再留出格子自带的内边距。 */
const ART_TRACK = 'calc(var(--table-art-size) + 2 * var(--spacingHorizontalS))';

/** 一列在 `grid-template-columns` 里的写法：fr 列带最窄宽度保底，缩略图列跟着行高，其余是像素。 */
export function columnTrack(id: ColumnId, widths: ColumnWidths): string {
  if (id === 'art') return ART_TRACK;
  const width = widthOf(widths, id);
  return columnDef(id).flexible ? `minmax(${MIN_WIDTH}px, ${width}fr)` : `${width}px`;
}

/**
 * 分隔条两侧的两列一起改：左列吃 `dx`，右列让出同样多，两列的和不变；两列都不窄于 `min`，
 * 夹住之后剩下的位移丢掉，不去推更远的列。两列原本就放不下两个 `min` 时不动。
 */
export function resizePair(
  left: number,
  right: number,
  dx: number,
  min: number = MIN_WIDTH,
): [number, number] {
  const sum = left + right;
  if (sum < min * 2) return [left, right];
  const nextLeft = Math.min(Math.max(left + dx, min), sum - min);
  return [nextLeft, sum - nextLeft];
}

/**
 * 把 `source` 挪到 `target` 前面（`after` 为真时后面）。封面不参与换位；两列里有一列不在列序里、
 * 或挪的就是它自己时原样返回一份。
 */
export function insertColumn(
  order: readonly ColumnId[],
  source: ColumnId,
  target: ColumnId,
  after: boolean,
): ColumnId[] {
  if (
    source === 'cover' ||
    target === 'cover' ||
    source === target ||
    !order.includes(source) ||
    !order.includes(target)
  ) {
    return [...order];
  }
  const next = order.filter((id) => id !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next;
}

/** 两列在列序里对调；中间隔着的看不见的列不动。 */
export function swapColumns(order: readonly ColumnId[], a: ColumnId, b: ColumnId): ColumnId[] {
  const next = [...order];
  const from = next.indexOf(a);
  const to = next.indexOf(b);
  if (from < 0 || to < 0) return next;
  next[from] = b;
  next[to] = a;
  return next;
}
