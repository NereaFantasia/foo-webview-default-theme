import type { QueueMenuTarget } from '../../playback/queue/QueueMenu.tsx';
import type { RowPoint } from '../../playback/queue/QueueRow.tsx';
import type { CoverflowItem } from '../scene/coverflowItems.ts';

export interface CoverflowMenuTarget {
  /** 封面流条目唯一键；条目移出列表时自动关闭对应菜单 */
  readonly itemKey: string;
  readonly menu: QueueMenuTarget;
}

/**
 * 构建封面流卡片右键菜单的目标锚点与上下文
 *
 * 菜单项复用队列页与历史页逻辑；若当前条目无有效曲目则不弹出菜单。
 * 对于队列段，以队列项身份为键，支持移除与插播操作
 */
export function menuTargetOf(
  item: CoverflowItem,
  items: readonly CoverflowItem[],
  at: RowPoint,
  play: () => void,
): CoverflowMenuTarget | null {
  const track = item.track;
  if (!track) return null;
  const nth = items.filter((other) => other.kind === item.kind).indexOf(item) + 1;
  const anchor: QueueMenuTarget['anchor'] =
    item.kind === 'current'
      ? { key: `current:${track.handle}`, kind: 'current', number: 0, track, row: null }
      : item.kind === 'queued'
        ? { key: item.entry, kind: 'queued', number: nth, track, row: null }
        : item.kind === 'played'
          ? { key: item.key, kind: 'review', number: nth, track, row: null }
          : {
              key: item.key,
              kind: item.kind === 'earlier' ? 'earlier' : 'upnext',
              number: item.row + 1,
              track,
              row: item.row,
            };
  return { itemKey: item.key, menu: { at, anchor, rows: [anchor], play } };
}
