import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ancestorsOf } from './tableKeys.ts';
import type { TableItem } from './tableItems.ts';

export interface TableFocus {
  /** 焦点所在的显示位；没有焦点时为 -1。 */
  readonly focus: number;
  /** 焦点落到这个键的条目上；null 是撤掉焦点。 */
  setFocusKey(key: string | null): void;
}

/**
 * 焦点那一条不在条目流里了，焦点改落到哪一条的键上。`before` 是最近一次找得到它时的条目流，`index` 是它在
 * 那里的位置。外面有一层分组头还在、而且收着：这一条是跟着收起来的，退到那个分组头上。否则这一条是被删掉了
 * （平铺表、或所在的组还开着），落到原位置上的那一条，原位置已过了尾就落到最后一条；空位跳过。条目流空了答 null。
 */
export function fallbackFocusKey<G>(
  before: readonly TableItem<G>[],
  index: number,
  items: readonly TableItem<G>[],
): string | null {
  const entries = { count: before.length, itemAt: (at: number) => before[at] };
  const shown = new Map(items.map((item) => [item.key, item]));
  for (const at of ancestorsOf(entries, index).reverse()) {
    const owner = shown.get(before[at]?.key ?? '');
    if (owner?.kind === 'group' && owner.collapsed) return owner.key;
  }
  const start = Math.min(index, items.length - 1);
  for (let at = start; at < items.length; at += 1) {
    const item = items[at];
    if (item && item.kind !== 'filler') return item.key;
  }
  for (let at = start - 1; at >= 0; at -= 1) {
    const item = items[at];
    if (item && item.kind !== 'filler') return item.key;
  }
  return null;
}

/**
 * 表格的键盘焦点，按条目的键记：条目流重排、上面的组开合之后仍跟着同一条。焦点那一条不在条目流里了，按
 * `fallbackFocusKey` 落到别处，键盘从那里接着走，不回到表头。
 */
export function useTableFocus<G>(items: readonly TableItem<G>[]): TableFocus {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focus = useMemo(
    () => (focusKey === null ? -1 : items.findIndex((item) => item.key === focusKey)),
    [items, focusKey],
  );
  // 最近一次找得到焦点时的条目流与位置；焦点那一条消失后，从这里找它该落到哪。
  const seen = useRef<{ readonly items: readonly TableItem<G>[]; readonly index: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (focus >= 0) {
      seen.current = { items, index: focus };
      return;
    }
    const before = seen.current;
    seen.current = null;
    if (focusKey === null || !before) return;
    setFocusKey(fallbackFocusKey(before.items, before.index, items));
  }, [items, focus, focusKey]);
  return { focus, setFocusKey };
}
