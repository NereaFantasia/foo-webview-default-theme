import { memo } from 'react';
import { QueueRow, type QueueRowProps } from './QueueRow.tsx';
import type { QueueListRow } from './useQueueList.ts';

interface QueueQueuedRowsProps {
  readonly rows: readonly QueueListRow[];
  readonly selected: ReadonlySet<string>;
  /** 键盘焦点所在行的键 */
  readonly tabKey: string | null;
  /** 处于拖拽状态的行键集合；未拖拽时为 undefined */
  readonly lifted: ReadonlySet<string> | undefined;
  readonly onPointerDown: QueueRowProps['onPointerDown'];
  readonly onPlay: QueueRowProps['onPlay'];
  readonly onMenu: QueueRowProps['onMenu'];
  readonly onFocus: QueueRowProps['onFocus'];
}

/**
 * 播放队列中已排队部分的行列表组件
 * 该区块未使用虚拟滚动，通过 memo 拦截「接下来播放」等其他区域引起的页面重渲染；在队列内容、选中态、键盘焦点与拖拽状态未变时复用已有 DOM 节点
 */
export const QueueQueuedRows = memo(function QueueQueuedRows(props: QueueQueuedRowsProps) {
  return props.rows.map((row) => (
    <QueueRow
      key={row.key}
      kind={row.kind}
      rowKey={row.key}
      number={row.number}
      track={row.track}
      selected={props.selected.has(row.key)}
      current={props.tabKey === row.key}
      lifted={props.lifted?.has(row.key) ?? false}
      onPointerDown={props.onPointerDown}
      onPlay={props.onPlay}
      onMenu={props.onMenu}
      onFocus={props.onFocus}
    />
  ));
});
