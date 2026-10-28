import { trackKeyOf } from '../../playback/playbackContract.ts';
import type { QueueEntry } from '../../playback/queue/queueState.ts';
import type { ReviewTrack } from '../../playback/queue/review/queueReviewModel.ts';
import type { UpNextRow, UpNextTrack, UpNextView } from '../../playback/queue/upNextModel.ts';

/**
 * Coverflow 条目线性序列数据模型与转换纯函数
 *
 * 将已播历史、正在播放、手动队列与接下来播放整合为单向线性索引序列；
 * 供封面流布局与曲目信息展示组件共同消费
 */

interface ItemBase {
  /** 分段前缀与曲目键联合标识；在序列内保持唯一性 */
  readonly key: string;
}

export interface PlayedItem extends ItemBase {
  readonly kind: 'played';
  readonly track: UpNextTrack;
}

/** 正在播放的列表里排在它前面的曲目（队列页「之前的曲目」），按来源列表的顺序，起播从这一行往下接着播 */
export interface EarlierItem extends ItemBase {
  readonly kind: 'earlier';
  readonly track: UpNextTrack;
  /** 播放来源标识与列表行号 */
  readonly guid: string;
  readonly row: number;
}

export interface CurrentItem extends ItemBase {
  readonly kind: 'current';
  /** 当前播放曲目引用（停止或未连接宿主时为 null） */
  readonly track: UpNextTrack | null;
}

export interface QueuedItem extends ItemBase {
  readonly kind: 'queued';
  readonly track: UpNextTrack;
  /** 队列服务中的行条目标识，供播放与菜单定位使用 */
  readonly entry: string;
}

export interface UpNextItem extends ItemBase {
  readonly kind: 'upNext';
  readonly track: UpNextTrack;
  /** 播放来源标识与列表行号 */
  readonly guid: string;
  readonly row: number;
}

export type CoverflowItem = PlayedItem | EarlierItem | CurrentItem | QueuedItem | UpNextItem;
export type CoverflowKind = CoverflowItem['kind'];

export interface CoverflowSources {
  /** 播放记录（时间正序，不含当前播放曲目）；推不出列表顺序（随机类顺序、停止、播列表外的曲目）时左边用它 */
  readonly review: readonly ReviewTrack[];
  /** 正在播放的列表里排在它前面的曲目，`total` 是总数，`rows` 只有已读的缓存页；有它时左边跟列表顺序 */
  readonly earlier: Pick<UpNextView, 'list' | 'rows' | 'total'>;
  readonly current: UpNextTrack | null;
  /** 手动播放队列（首项为下一首） */
  readonly queue: readonly QueueEntry[];
  readonly upNext: Pick<UpNextView, 'list' | 'rows'>;
}

export function currentKeyOf(track: UpNextTrack | null): string {
  return `current:${trackKeyOf(track)}`;
}

/**
 * 来源列表里的一行在条目表里的键。之前的曲目、正在播放、接下来三段里的列表行都用这一种，不带段名：
 * 起播一首后，它从「接下来」（或「之前的曲目」）变成「正在播放」，被跳过的几首从「接下来」变成「之前的曲目」，
 * 键不变，引擎才认得这是同一张卡，选中不动，其余的卡围着它重排；带段名的键会让整排卡当成换了一批
 */
const listKeyOf = (row: string): string => `list:${row}`;

/**
 * 组装 Coverflow 完整条目序列
 *
 * 顺序排列左边（之前的曲目或播放记录）、正在播放、手动队列及接下来曲目，与队列页的顺序一致；当前播放条目始终占位。
 * 左边优先跟正在播放的列表：从起播一首跳到后面的曲目时，被跳过的几首就排在新的当前曲目左边，列表顺序不乱；
 * 没有列表顺序可跟时用播放记录。之前的曲目与接下来的曲目都只提取紧挨着当前曲目、连续缓存的页面数据，避免分页跳跃
 */
export function coverflowItems(sources: CoverflowSources): CoverflowItem[] {
  const items: CoverflowItem[] = [];
  const { list: earlierList, rows: earlierRows, total: earlierTotal } = sources.earlier;
  if (earlierList && earlierTotal > 0) {
    const byOffset = new Map(earlierRows.map((row) => [row.offset, row]));
    const nearest: UpNextRow[] = [];
    for (let offset = earlierTotal - 1; offset >= 0; offset--) {
      const row = byOffset.get(offset);
      if (!row) break;
      nearest.push(row);
    }
    for (const row of nearest.reverse()) {
      items.push({
        key: listKeyOf(row.key),
        kind: 'earlier',
        track: row.track,
        guid: earlierList.guid,
        row: row.row,
      });
    }
  } else {
    for (const row of sources.review) {
      items.push({ key: `played:${row.key}`, kind: 'played', track: row.track });
    }
  }
  // 正在播放的是列表里的一行时，它的行号就是前面有几首（之前的曲目的总数），键与它做「接下来」时的键相同
  const key =
    earlierList && sources.current
      ? listKeyOf(`${earlierList.guid}:${earlierTotal}:${sources.current.handle}`)
      : currentKeyOf(sources.current);
  items.push({ key, kind: 'current', track: sources.current });
  for (const entry of sources.queue) {
    items.push({
      key: `queued:${entry.key}`,
      kind: 'queued',
      track: entry.track,
      entry: entry.key,
    });
  }
  const { list, rows } = sources.upNext;
  if (list) {
    const byOffset = new Map(rows.map((row) => [row.offset, row]));
    for (let offset = 0; ; offset++) {
      const row = byOffset.get(offset);
      if (!row) break;
      items.push({
        key: listKeyOf(row.key),
        kind: 'upNext',
        track: row.track,
        guid: list.guid,
        row: row.row,
      });
    }
  }
  return items;
}

/** 「正在播放」那一条的位置；`coverflowItems` 拼出的表里总有它 */
export function currentIndexOf(items: readonly CoverflowItem[]): number {
  return items.findIndex((item) => item.kind === 'current');
}

/** 选中项的位置：没选或键对不上任何条目（队列在别处变了）时是正在播放那一条 */
export function selectedIndexOf(items: readonly CoverflowItem[], browsed: string | null): number {
  if (browsed !== null) {
    const at = items.findIndex((item) => item.key === browsed);
    if (at >= 0) return at;
  }
  return currentIndexOf(items);
}
