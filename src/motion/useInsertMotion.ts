import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useLayoutEffect, useRef, type RefCallback } from 'react';
import { reducedMotionAtom } from './reducedMotion.ts';
import { insertMotion } from './stepTransition.ts';

/**
 * 一块后来插进来时按列表增删进场：跟在它后面的兄弟先从原位置让出它占的位置，167 ms 点到点，
 * 它自己等让位播完再 83 ms 淡入。返回的 ref 挂到这一块的最外层。`animate` 取挂上那一刻的值：
 * 为假时直接出现，用于这一块随所在的页面一起出现、不是后来插进来的情况。
 */
export function useInsertMotion<E extends HTMLElement>(animate: boolean): RefCallback<E> {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const latest = useRef({ animate, reduced });
  useLayoutEffect(() => {
    latest.current = { animate, reduced };
  });
  return useCallback((element: E | null) => {
    if (!element || !latest.current.animate) return;
    const next = element.nextElementSibling;
    // 让出的距离含兄弟之间的间距：量到下一个兄弟的上沿，没有下一个时就是自己的高度。量布局位置，
    // 不含变换：所在的对话框可能还在入场缩放。
    const shift =
      next instanceof HTMLElement ? next.offsetTop - element.offsetTop : element.offsetHeight;
    const motion = insertMotion(shift, latest.current.reduced);
    element.animate(motion.inserted.keyframes, motion.inserted.options);
    for (let sibling = next; sibling; sibling = sibling.nextElementSibling) {
      if (sibling instanceof HTMLElement) {
        sibling.animate(motion.following.keyframes, motion.following.options);
      }
    }
  }, []);
}
