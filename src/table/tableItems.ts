import type { Track } from 'foo-webview-sdk';
import type { ReactNode } from 'react';

// 曲目表格吃的条目、曲目字段与交出去的落点，以及按条目流数出的读屏行号。表格只认这里的形状：条目流怎么排
// （分组、折叠、垫位）归表格的调用方。

/**
 * 一行曲目要的字段；库与播放列表的曲目行都满足它。后几列的字段可以缺：行里没有的那一列画成空格，提供那几列的
 * 表自己负责带上。
 */
export type TableTrack = Pick<
  Track,
  | 'handle'
  | 'path'
  | 'absolutePath'
  | 'subsong'
  | 'title'
  | 'artist'
  | 'album'
  | 'trackNumber'
  | 'discNumber'
  | 'duration'
  | 'rating'
> &
  Partial<
    Pick<
      Track,
      | 'albumArtist'
      | 'genre'
      | 'date'
      | 'codec'
      | 'bitrate'
      | 'sampleRate'
      | 'channels'
      | 'fileSize'
    >
  > & {
    /** SDK 的多值艺人字段；没有有效值时显示完整的 artist 署名。 */
    readonly artists?: readonly string[];
    readonly albumArtists?: readonly string[];
    /** foo_playcount 的添加时间与最近播放，写成「YYYY-MM-DD HH:MM:SS」；没有或还没取到时缺。 */
    readonly added?: string;
    readonly lastPlayed?: string;
    /** 播放次数；没装 foo_playcount 或还没取到时缺。 */
    readonly playCount?: number;
  };

/** 格子里的链接：给了就把那一列的字画成链接，单击交给调用方。要给稳定的对象。 */
export interface TableLinks {
  /** 艺人列：交回所点的完整名字与当前曲目，不拆分单值署名。 */
  readonly artist?: (name: string, track: TableTrack) => void;
  /** 专辑列：去这首所在的那张专辑。 */
  readonly album?: (track: TableTrack) => void;
}

/** 缩略图列的画法：表格不认识封面服务，由调用方按曲目画一张边长 `size`（CSS 像素）的图。 */
export type TableArtwork = (track: TableTrack, size: number) => ReactNode;

export interface TableRowItem {
  readonly kind: 'row';
  /** 虚拟列表与 React 的键，整条流里唯一。 */
  readonly key: string;
  /**
   * 行序号：选中按它记。折叠、分组改变显示位置，行序号不变。要随显示顺序递增：Shift 扩选按行序号的区间算，
   * 就地重排之后要按新顺序重编，并清空选中。
   */
  readonly order: number;
  /** 还没取到时为 undefined，画骨架行。 */
  readonly track: TableTrack | undefined;
}

/** 分组头（流派节、专辑分组、碟号）。表格只管它的层级与开合，长什么样由调用方画。 */
export interface TableGroupItem<G> {
  readonly kind: 'group';
  readonly key: string;
  /** 0 是最外层；键盘往「上一层」走时按它找。 */
  readonly level: number;
  readonly collapsed: boolean;
  readonly data: G;
}

/** 视口坐标，CSS 像素；菜单的落点。 */
export interface TablePoint {
  readonly x: number;
  readonly y: number;
}

/** 只占一行高度的空位：组里的行不够高、放不下跨行的封面时垫在组尾。 */
export interface TableFillerItem {
  readonly kind: 'filler';
  readonly key: string;
}

export type TableItem<G = unknown> = TableRowItem | TableGroupItem<G> | TableFillerItem;

/** 读屏用的行号与层级，按显示位排；空位不是行。 */
export interface TableAriaRows {
  /** 条目流里有几行（不算空位），不含列头。 */
  readonly count: number;
  /** 各显示位的 `aria-rowindex`：列头是 1，行从 2 数起；空位是 0。 */
  readonly rowIndex: readonly number[];
  /** 各显示位的 `aria-level`：分组头是它的层级加 1，曲目行比它上面最近的分组头深一层，不在分组里的是 1。 */
  readonly level: readonly number[];
}

export function ariaRowsOf<G>(items: readonly TableItem<G>[]): TableAriaRows {
  const rowIndex: number[] = [];
  const level: number[] = [];
  let count = 0;
  let groupLevel = -1;
  for (const item of items) {
    if (item.kind === 'filler') {
      rowIndex.push(0);
      level.push(0);
      continue;
    }
    count += 1;
    rowIndex.push(count + 1);
    if (item.kind === 'group') groupLevel = item.level;
    level.push(item.kind === 'group' ? item.level + 1 : groupLevel + 2);
  }
  return { count, rowIndex, level };
}
