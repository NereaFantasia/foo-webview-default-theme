import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { queueReviewAtom } from './review/queueReview.ts';
import { queueViewAtom } from './queueState.ts';
import { upNextAtom } from './upNext.ts';
import { createQueueStateMotion } from './queueStateMotion.ts';

/** 各分区独立接收可信快照，来源临时清空与分页填充不会反复入场。 */
export function useQueueStateMotion(root: RefObject<HTMLElement | null>) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const review = useAtomValueRawSync(queueReviewAtom);
  const queued = useAtomValueRawSync(queueViewAtom);
  const upcoming = useAtomValueRawSync(upNextAtom);
  const lanes = useRef<ReturnType<typeof createQueueStateMotion>[]>([]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // 播放历史挂在右侧卡的插槽里，不在队列页的根下面，历史那一道在它自己的区域里找行。
    const history =
      element
        .closest('[data-right-card]')
        ?.querySelector<HTMLElement>('[data-queue-review-region]') ?? element;
    lanes.current = (['queued', 'upnext', 'review'] as const).map((lane) =>
      createQueueStateMotion(lane === 'review' ? history : element, lane),
    );
    return () => {
      lanes.current.forEach((lane) => lane.dispose());
      lanes.current = [];
    };
  }, [root]);
  useLayoutEffect(() => {
    const counts = new Map<string, number>();
    for (const entry of queued.entries)
      counts.set(entry.track.handle, (counts.get(entry.track.handle) ?? 0) + 1);
    const ambiguous = new Set(
      [...counts].filter(([, count]) => count > 1).map(([handle]) => handle),
    );
    const shared = { current: review.current, backward: review.direction === 'backward', reduced };
    lanes.current[0]?.update({
      ...shared,
      ambiguous,
      pending: queued.status === 'connecting',
      keys: new Set(queued.entries.map((entry) => entry.key)),
      revision: JSON.stringify(queued.entries.map((entry) => entry.key)),
    });
    lanes.current[1]?.update({
      ...shared,
      revision: String(upcoming.version),
      pending: upcoming.refreshing,
    });
    const frame = requestAnimationFrame(() =>
      lanes.current[2]?.update({
        ...shared,
        keys: new Set(review.rows.map((row) => row.key)),
        revision: String(review.version),
      }),
    );
    return () => cancelAnimationFrame(frame);
  });
}
