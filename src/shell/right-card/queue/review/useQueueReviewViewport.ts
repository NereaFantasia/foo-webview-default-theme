import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { QueueReviewView } from './queueReviewModel.ts';
import { QUEUE_ROW_HEIGHT, useQueueVirtualRows } from '../useQueueVirtualRows.ts';

/** 平时最多露几行。 */
const NORMAL_ROWS = 5;
/** 平时给队列留的高度：当前曲目卡与几行「接下来」。 */
const NORMAL_RESERVE = 240;
/**
 * 拉开后给队列留的高度，CSS 像素：紧凑态的当前曲目卡（64）加一行（48），再加历史区上方的留白、底板的上下
 * 内边距、箭头那一条与队列页的上内边距。
 */
const GROWN_RESERVE = 160;

/**
 * 回看独立滚动，打开时落在最近几首；读更早记录时，新曲目不抢走阅读位置。平时最多露 5 行；拉开后撑到给队列
 * 留下紧凑态当前卡与一行的高度。可用高度按右侧卡里历史区插槽以下量，不随历史区自己的开合与动画变。
 */
export function useQueueReviewViewport(
  records: RefObject<HTMLDivElement | null>,
  slot: HTMLElement | null,
  view: QueueReviewView,
  open: boolean,
  grown: boolean,
) {
  const { total } = view;
  const previous = useRef(view);
  const [capacity, setCapacity] = useState({ normal: NORMAL_ROWS, grown: NORMAL_ROWS });
  const following = useRef(true);
  const wasOpen = useRef(false);
  const limit = grown ? capacity.grown : capacity.normal;
  const height = Math.min(limit, total) * QUEUE_ROW_HEIGHT;
  const viewport = useQueueVirtualRows(records, total, records);
  useLayoutEffect(() => {
    const card = slot?.closest<HTMLElement>('[data-right-card]');
    if (!slot || !card) return;
    const measure = () => {
      const space = card.getBoundingClientRect().bottom - slot.getBoundingClientRect().top;
      const normal = Math.max(
        1,
        Math.min(NORMAL_ROWS, Math.floor((space - NORMAL_RESERVE) / QUEUE_ROW_HEIGHT)),
      );
      setCapacity({
        normal,
        grown: Math.max(normal, Math.floor((space - GROWN_RESERVE) / QUEUE_ROW_HEIGHT)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [slot]);
  useLayoutEffect(() => {
    const box = records.current;
    if (!box) return;
    const follow = () => {
      following.current = box.scrollHeight - box.clientHeight - box.scrollTop < 2;
    };
    box.addEventListener('scroll', follow, { passive: true });
    return () => box.removeEventListener('scroll', follow);
  }, [records]);
  useLayoutEffect(() => {
    const box = records.current;
    if (box && open) {
      const oldIndex = Math.floor(box.scrollTop / QUEUE_ROW_HEIGHT);
      const anchor = previous.current.rows[oldIndex]?.key;
      const newIndex = view.rows.findIndex((row) => row.key === anchor);
      const offset =
        !wasOpen.current || following.current
          ? Math.max(0, total * QUEUE_ROW_HEIGHT - height)
          : newIndex >= 0
            ? newIndex * QUEUE_ROW_HEIGHT + (box.scrollTop % QUEUE_ROW_HEIGHT)
            : box.scrollTop;
      box.scrollTop = offset;
      // 阅读锚点补偿不是用户滚动，不中断这一轮曲目补位。
      box.dataset.queueMotionScroll = String(box.scrollTop);
      viewport.virtualizer.scrollToOffset(offset);
    }
    previous.current = view;
    wasOpen.current = open;
  }, [open, total, height, records, viewport.virtualizer, view]);
  return {
    ...viewport,
    regionHeight: height,
    /** 记录多过平时露得下的行数，而且拉开能多露几行：这时出箭头。 */
    overflow: total > capacity.normal && capacity.grown > capacity.normal,
  };
}
