import type { RefObject } from 'react';
import { useVirtualFold, type FoldSpan } from '../motion/useVirtualFold.ts';
import type { TableGroupItem, TableItem } from './tableItems.ts';

interface GroupFoldOptions<G> {
  readonly root: RefObject<HTMLElement | null>;
  readonly scroller: RefObject<HTMLElement | null>;
  readonly items: readonly TableItem<G>[];
  readonly rowHeight: number;
  readonly groupHeight: (item: TableGroupItem<G>) => number;
  readonly enabled: ((item: TableGroupItem<G>) => boolean) | undefined;
}

/** 副本按这些属性画列宽、展开箭头、层级缩进与碟号。 */
const KEEP = new Set(['data-column-id', 'data-expanded', 'data-level', 'data-disc']);

function spanOf<G>(options: GroupFoldOptions<G>, index: number): FoldSpan {
  const group = options.items[index];
  let end = index + 1;
  let height = 0;
  const body = new Set<string>();
  if (group?.kind === 'group') {
    for (; end < options.items.length; end++) {
      const item = options.items[end];
      if (!item || (item.kind === 'group' && item.level <= group.level)) break;
      body.add(item.key);
      height += item.kind === 'group' ? options.groupHeight(item) : options.rowHeight;
    }
  }
  return { body, below: new Set(options.items.slice(end).map((item) => item.key)), height };
}

/** 表格分组的单组开合动画：只有 `enabled` 认可的组播放，其余组和批量开合照常直接到位。 */
export function useTableGroupFold<G>(options: GroupFoldOptions<G>) {
  const { items, enabled } = options;
  const fold = useVirtualFold({
    root: options.root,
    scroller: options.scroller,
    enabled: enabled !== undefined,
    keyAttribute: 'data-table-item-key',
    markAttribute: 'data-table-fold-ghost',
    extras: '[data-table-group-body]',
    keep: KEEP,
    floor: (root) => root.querySelector<HTMLElement>('[data-table-body]'),
    version: items,
    stateOf(key) {
      const item = items.find((entry) => entry.key === key);
      if (item?.kind !== 'group') return null;
      return item.collapsed ? 'closed' : 'open';
    },
    spanOf: (key) =>
      spanOf(
        options,
        items.findIndex((item) => item.key === key),
      ),
  });
  return {
    run(index: number, action: (() => void) | undefined) {
      if (!action) return;
      const item = items[index];
      if (item?.kind !== 'group' || !enabled?.(item)) {
        fold.stop();
        action();
        return;
      }
      fold.run(item.key, action);
    },
    commit: fold.commit,
    stop: fold.stop,
  };
}
