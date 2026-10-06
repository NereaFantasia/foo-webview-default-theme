import { useId, type RefObject } from 'react';
import type { KeyChord } from '../../../nav/commandRegistry.ts';
import { useCommand } from '../../../nav/useCommand.ts';
import { QUEUE_KEYS } from '../../../nav/queueKeys.ts';
import type { RowPoint } from './QueueRow.tsx';
import type { QueueList, QueueListRow } from './useQueueList.ts';

export interface QueueKeysOptions {
  /** 队列页的根：焦点在它里面时这些键才归队列。 */
  readonly root: RefObject<HTMLElement | null>;
  readonly list: QueueList;
  /** 虚拟列表先将目标滚入视口、读取该页，再把焦点交给真正的曲目行。 */
  navigate?(pick: (index: number) => number, shift: boolean): void;
  readonly total?: number;
  play(row: QueueListRow): void;
  remove(rows: readonly QueueListRow[]): void;
  shift(rows: readonly QueueListRow[], delta: -1 | 1): void;
  menu(key: string, at: RowPoint): void;
  undo(): void;
  redo(): void;
}

/** 行的 DOM 节点；行的身份里有 `#`、`|`、`:`，按 id 找不用转义。 */
export function rowElement(key: string): HTMLElement | null {
  return document.getElementById(`queue-row-${key}`);
}

/** 焦点移到这一行：等这一次渲染把它设成可聚焦的那一行再移。 */
function focusRow(key: string): void {
  queueMicrotask(() => rowElement(key)?.focus());
}

/**
 * 队列页的按键，登记在获焦的列表部件这一层，焦点在队列页里才认领：↑ ↓ Home End 移焦点并选中（Shift 扩选），
 * Enter 立即播放，Delete 移除，Alt+↑ / Alt+↓ 上移、下移一位（同侧边栏的播放列表），Ctrl+Z 撤销、Ctrl+Y 与
 * Ctrl+Shift+Z 重做，菜单键与 Shift+F10 在焦点行上开菜单。
 */
export function useQueueKeys(options: QueueKeysOptions): void {
  const { root, list } = options;
  // 窗口跨档时停靠的卡与浮层可能同时挂着各一份队列页，命令 id 带上实例，免得后登记的顶掉先登记的。
  const scope = useId();
  const scoped = (id: string) => `${id}.${scope}`;
  // 回看与正在播的这一首前面那几行各有自己的按键，焦点在那里时不归这里管。
  const inside = () => {
    const focused = document.activeElement;
    return (
      focused !== null &&
      !focused.closest(
        '[data-queue-review-records], [data-queue-review-toggle], [data-queue-earlier], button',
      ) &&
      (root.current?.contains(focused) ?? false)
    );
  };
  const onRow = () => inside() && list.current !== null;
  const focusedRow = () => (list.current ? list.rowOf(list.current) : undefined);

  const step = (id: string, keys: readonly KeyChord[], pick: (index: number) => number) => ({
    id,
    layer: 'widget' as const,
    keys,
    enabled: () => inside() && (options.total ?? list.rows.length) > 0,
    run: () => {
      if (options.navigate) {
        options.navigate(
          pick,
          keys.some((chord) => chord.shift),
        );
        return;
      }
      const index = list.current ? list.rows.findIndex((row) => row.key === list.current) : -1;
      const next = list.rows[Math.max(0, Math.min(list.rows.length - 1, pick(index)))];
      if (!next) return;
      list.activate(next.key, { ctrl: false, shift: keys.some((chord) => chord.shift) });
      focusRow(next.key);
    },
  });
  useCommand(step(scoped('queue.up'), [{ key: 'ArrowUp' }], (index) => index - 1));
  useCommand(step(scoped('queue.down'), [{ key: 'ArrowDown' }], (index) => index + 1));
  useCommand(
    step(scoped('queue.extendUp'), [{ key: 'ArrowUp', shift: true }], (index) => index - 1),
  );
  useCommand(
    step(scoped('queue.extendDown'), [{ key: 'ArrowDown', shift: true }], (index) => index + 1),
  );
  useCommand(step(scoped('queue.first'), [{ key: 'Home' }], () => 0));
  useCommand(step(scoped('queue.extendFirst'), [{ key: 'Home', shift: true }], () => 0));
  useCommand(
    step(
      scoped('queue.extendLast'),
      [{ key: 'End', shift: true }],
      () => (options.total ?? list.rows.length) - 1,
    ),
  );
  useCommand(
    step(scoped('queue.last'), [{ key: 'End' }], () => (options.total ?? list.rows.length) - 1),
  );

  useCommand({
    id: scoped('queue.all'),
    layer: 'widget',
    keys: [{ key: 'a', ctrl: true }],
    enabled: inside,
    run: () => list.selectAll(),
  });
  useCommand({
    id: scoped('queue.play'),
    layer: 'widget',
    keys: QUEUE_KEYS.play,
    enabled: onRow,
    run: () => {
      const row = focusedRow();
      if (row) options.play(row);
    },
  });
  useCommand({
    id: scoped('queue.remove'),
    layer: 'widget',
    keys: QUEUE_KEYS.remove,
    enabled: () => inside() && list.queuedTargets().length > 0,
    run: () => options.remove(list.queuedTargets()),
  });
  const shift = (name: string, keys: readonly KeyChord[], delta: -1 | 1) => ({
    id: scoped(`queue.shift.${name}`),
    layer: 'widget' as const,
    keys,
    enabled: () => inside() && list.queuedTargets().length > 0,
    run: () => options.shift(list.queuedTargets(), delta),
  });
  useCommand(shift('up', QUEUE_KEYS.moveUp, -1));
  useCommand(shift('down', QUEUE_KEYS.moveDown, 1));
  useCommand({
    id: scoped('queue.undo'),
    layer: 'widget',
    keys: QUEUE_KEYS.undo,
    enabled: inside,
    run: () => options.undo(),
  });
  useCommand({
    id: scoped('queue.redo'),
    layer: 'widget',
    keys: QUEUE_KEYS.redo,
    enabled: inside,
    run: () => options.redo(),
  });
  useCommand({
    id: scoped('queue.menu'),
    layer: 'widget',
    keys: QUEUE_KEYS.menu,
    enabled: onRow,
    run: () => {
      const key = list.current;
      const box = key ? rowElement(key)?.getBoundingClientRect() : undefined;
      if (key && box) options.menu(key, { x: box.left + box.width / 2, y: box.bottom });
    },
  });
}
