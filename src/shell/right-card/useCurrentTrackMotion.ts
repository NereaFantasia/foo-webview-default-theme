import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { queueReviewAtom } from './queue/review/queueReview.ts';
import { createQueueStateMotion } from './queue/queueStateMotion.ts';

/** 资料与图像分别按身份切换；封面迟到不重播文字，同图继续沿用。 */
export function useCurrentTrackMotion(
  root: RefObject<HTMLElement | null>,
  handle: string | null,
  cover: string | null,
  collapsed: boolean,
) {
  const review = useAtomValueRawSync(queueReviewAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const motion = useRef<ReturnType<typeof createQueueStateMotion> | null>(null);
  useLayoutEffect(() => {
    if (!root.current) return;
    motion.current = createQueueStateMotion(root.current, 'current');
    return () => {
      motion.current?.dispose();
      motion.current = null;
    };
  }, [root, collapsed]);
  useLayoutEffect(() => {
    motion.current?.update({
      revision: JSON.stringify([handle, cover]),
      current: handle,
      backward: review.direction === 'backward',
      reduced,
    });
  });
}
