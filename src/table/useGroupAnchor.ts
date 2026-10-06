import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { TableGroupItem, TableItem } from './tableItems.ts';

export interface GroupAnchorOptions<G> {
  readonly items: readonly TableItem<G>[];
  readonly rowHeight: number;
  readonly groupHeight: (item: TableGroupItem<G>) => number;
  readonly scroller: RefObject<HTMLElement | null>;
  /** 表体顶边在滚动内容里的纵坐标，见 `ScrollFrame.margin`。 */
  readonly margin: number;
}

/** 开合第 `index` 个条目所在的分组，前后让这个条目在视口里的位置不变。`run` 不给时什么也不做。 */
export type GroupAnchor = (index: number, run: ((index: number) => void) | undefined) => void;

interface Pending<G> {
  readonly key: string;
  /** 这个条目的顶边离视口顶边多远，CSS 像素。 */
  readonly offset: number;
  readonly items: readonly TableItem<G>[];
}

/** 第 `index` 个条目在条目流里的起点。高度的算法要与 `useTrackTableRows` 交给虚拟化器的一致。 */
function itemOffset<G>(
  items: readonly TableItem<G>[],
  index: number,
  rowHeight: number,
  groupHeight: (item: TableGroupItem<G>) => number,
): number {
  let offset = 0;
  for (let at = 0; at < index && at < items.length; at += 1) {
    const item = items[at];
    offset += item?.kind === 'group' ? groupHeight(item) : rowHeight;
  }
  return offset;
}

/**
 * 分组开合时的滚动补偿。开合一组会让它下面的条目整体上移或下移，展开同级时它上面的也会变高；滚动位置靠后时
 * 新的总高撑不住原来的滚动量，浏览器把它夹回去，整屏跟着跳。所以开合之前记下那个条目在视口里的位置，
 * 条目流换好之后把滚动量补回去；到了末尾仍受最大滚动量限制，补不满就停在能到的地方。
 *
 * 调用方要是在这一帧里没换条目流（没接开合、或者开合是异步的），记下的位置到下一帧作废，不留到以后误用。
 */
export function useGroupAnchor<G>(options: GroupAnchorOptions<G>): GroupAnchor {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const pending = useRef<Pending<G> | null>(null);
  const [hold] = useState(() => {
    const anchor: GroupAnchor = (index, run) => {
      const { items, rowHeight, groupHeight, scroller, margin } = latest.current;
      const item = items[index];
      if (!run || !item) return;
      const top = scroller.current?.scrollTop ?? 0;
      const offset = margin + itemOffset(items, index, rowHeight, groupHeight) - top;
      const next: Pending<G> = { key: item.key, offset, items };
      pending.current = next;
      requestAnimationFrame(() => {
        if (pending.current === next) pending.current = null;
      });
      run(index);
    };
    return anchor;
  });

  const { items, rowHeight, groupHeight, scroller, margin } = options;
  useLayoutEffect(() => {
    const record = pending.current;
    const box = scroller.current;
    if (!record || record.items === items) return;
    pending.current = null;
    const index = items.findIndex((item) => item.key === record.key);
    if (!box || index < 0) return;
    box.scrollTop = margin + itemOffset(items, index, rowHeight, groupHeight) - record.offset;
  });
  return hold;
}
