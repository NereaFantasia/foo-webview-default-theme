import type { MessageKey } from '../../i18n/en.ts';

// 曲目表格列系统：定义、列宽模型与列序纯函数；状态管理与持久化位于 `columnsModel.ts`

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
  | 'art'
  | 'sampleRate'
  | 'channels'
  | 'fileSize';

export interface ColumnDef {
  readonly id: ColumnId;
  /** 列名（用于列选择菜单、拖拽投影与辅助读屏） */
  readonly label: MessageKey;
  /** 列头文本标签；null 表示列头不显示文本 */
  readonly heading: MessageKey | null;
  /** 标记是否为数字列（启用右对齐与等宽字体） */
  readonly numeric: boolean;
  /** 标记该列是否支持点击排序（具体排序行为由表格调用方接管） */
  readonly sortable: boolean;
  /** 宽度固定列：右侧不显示拖拽分割线，其他列调整宽度时不挤占该列 */
  readonly fixed: boolean;
  /** 旧版本中基于比例权重的弹性列，迁移时依据容器宽度换算像素 */
  readonly flexible: boolean;
}

/** 曲目表格通用扩展列；各页面默认折叠收起，用户勾选后按持久化配置恢复 */
export const EXTENDED_COLUMNS: readonly ColumnId[] = [
  'albumArtist',
  'year',
  'genre',
  'added',
  'playCount',
  'lastPlayed',
  'codec',
  'bitrate',
  'sampleRate',
  'channels',
  'fileSize',
  'path',
];
/**
 * 原先只有基本列的表（播放列表、文件夹、流派）开放扩展字段时，存档的列宽项数还不到这么多；
 * 读回这样的旧存档时把扩展字段收起，之后照用户的勾选恢复
 */
export const EXTENDED_INTRODUCED = { widthCount: 21, columns: EXTENDED_COLUMNS } as const;

/** 多数列的样子：列头写列名、能排序、存像素宽；与它不同的几项逐列写明 */
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
 * （`STORED_COUNTS`）
 */
export const COLUMNS: readonly ColumnDef[] = [
  column('cover', 'table.cover', { sortable: false }),
  // 状态列只画选中的记号，没有能排的字段
  column('status', 'table.status', { heading: null, sortable: false, fixed: true }),
  column('number', 'table.number', { heading: 'table.numberHeading', numeric: true }),
  column('title', 'table.title', { flexible: true }),
  column('artist', 'table.artist', { flexible: true }),
  // 等级列按五颗星的内容设宽
  column('rating', 'table.rating', { fixed: true }),
  column('duration', 'table.duration', { numeric: true }),
  column('album', 'table.album', { flexible: true }),
  column('albumArtist', 'table.albumArtist', { flexible: true }),
  column('year', 'table.year', { numeric: true }),
  column('genre', 'table.genre'),
  // 两种时间都只写到日，等宽数字右对齐，上下行对得齐
  column('added', 'table.added', { numeric: true }),
  column('playCount', 'table.playCount', { numeric: true }),
  column('lastPlayed', 'table.lastPlayed', { numeric: true }),
  column('codec', 'table.codec'),
  column('bitrate', 'table.bitrate', { numeric: true }),
  column('path', 'table.path', { flexible: true }),
  // 缩略图列每行一张小封面，宽度跟着行高走（见 `columnTrack`），存档里的那一项不用
  column('art', 'table.art', { heading: null, sortable: false, fixed: true }),
  column('sampleRate', 'table.sampleRate', { numeric: true }),
  column('channels', 'table.channels', { numeric: true }),
  column('fileSize', 'table.fileSize', { numeric: true }),
];

/**
 * 各版存档的列数。七项的还没有专辑列，八项的还没有专辑艺术家以后的十列；读回时缺的列补上缺省宽、记成藏着，
 * 存档时还没有这些列的表上不会突然多出列来
 */
export const STORED_COUNTS: readonly number[] = [7, 8, 18, COLUMNS.length];

export const COLUMN_IDS: readonly ColumnId[] = COLUMNS.map((column) => column.id);

const BY_ID = new Map(COLUMNS.map((column) => [column.id, column]));

export function columnDef(id: ColumnId): ColumnDef {
  const column = BY_ID.get(id);
  if (!column) throw new Error(`没有这一列：${id}`);
  return column;
}

/** 这一列在存档列宽里的下标 */
export function columnIndex(id: ColumnId): number {
  return COLUMN_IDS.indexOf(id);
}

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === 'string' && COLUMN_IDS.some((id) => id === value);
}

/**
 * 缺省的显示顺序：缩略图紧贴标题左边，专辑紧跟艺术家，后来加的几列排在专辑与等级之间，等级与时长留在最右
 * 封面恒在最左，不参与换位
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
  'sampleRate',
  'channels',
  'fileSize',
  'path',
  'rating',
  'duration',
];

/** 标题列不能藏：别的列全藏掉时表里还得有内容 */
export const REQUIRED_COLUMN: ColumnId = 'title';

/** 按 `COLUMNS` 的下标排，长度恒为 `COLUMNS.length`，单位为 CSS 像素 */
export type ColumnWidths = readonly number[];

/** 独立像素列宽；窗口变宽时保留右侧空白，不拉伸用户的列 */
export const DEFAULT_WIDTHS: ColumnWidths = [
  120, 24, 52, 280, 160, 88, 60, 180, 160, 52, 96, 96, 60, 96, 64, 72, 320, 48, 96, 56, 96,
];

/** 按 `COLUMNS` 的顺序收成全部列的项数；多的丢掉，缺的补 0 */
export function toWidths(values: readonly number[]): ColumnWidths {
  return COLUMNS.map((_, at) => values[at] ?? 0);
}

/** 拖分隔条时普通列的最窄宽度，CSS 像素；封面列可以拖到 0 */
export const MIN_WIDTH = 32;

export function widthOf(widths: ColumnWidths, id: ColumnId): number {
  return widths[columnIndex(id)] ?? 0;
}

export function withWidth(widths: ColumnWidths, id: ColumnId, width: number): ColumnWidths {
  const next = [...widths];
  next[columnIndex(id)] = width;
  return toWidths(next);
}

/** 缩略图列的宽：表格按行高给的缩略图边长（`--table-art-size`），左右再留出格子自带的内边距 */
const ART_TRACK = 'calc(var(--table-art-size) + 2 * var(--spacingHorizontalS))';

/** 缩略图列跟着行高，其余列使用独立像素宽度 */
export function columnTrack(id: ColumnId, widths: ColumnWidths): string {
  if (id === 'art') return ART_TRACK;
  const width = widthOf(widths, id);
  return `${width}px`;
}

/**
 * 把 `source` 挪到 `target` 前面（`after` 为真时后面）。封面不参与换位；两列里有一列不在列序里、
 * 或挪的就是它自己时原样返回一份
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

/** 两列在列序里对调；中间隔着的看不见的列不动 */
export function swapColumns(order: readonly ColumnId[], a: ColumnId, b: ColumnId): ColumnId[] {
  const next = [...order];
  const from = next.indexOf(a);
  const to = next.indexOf(b);
  if (from < 0 || to < 0) return next;
  next[from] = b;
  next[to] = a;
  return next;
}
