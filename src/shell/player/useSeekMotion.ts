import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { createSeekMotion, type SeekMotionClock, type SeekMotionInput } from './seekMotion.ts';

/** 填充与指示器共用时钟、各自保留显示位置；鼠标定位只让填充缓动，之后切换输入也从各自位置接续。 */
export function useSeekMotion(
  element: RefObject<HTMLElement | null>,
  input: Omit<SeekMotionInput, 'visible'>,
): void {
  const latest = useRef(input);
  const motion = useMemo(() => {
    let time = 0;
    const clock: SeekMotionClock = {
      now: () => time,
      request: (callback) =>
        requestAnimationFrame((now) => {
          time = now;
          callback();
        }),
      cancel: (handle) => cancelAnimationFrame(handle),
    };
    const progress = createSeekMotion(clock, (fraction) =>
      element.current?.style.setProperty('--seek-progress', String(fraction)),
    );
    const indicator = createSeekMotion(clock, (fraction) =>
      element.current?.style.setProperty('--seek-indicator', String(fraction)),
    );
    return {
      update(next: SeekMotionInput) {
        time = performance.now();
        progress.update(next);
        indicator.update(
          next.intent?.kind === 'click'
            ? { ...next, intent: { ...next.intent, kind: 'drag' } }
            : next,
        );
      },
      dispose() {
        progress.dispose();
        indicator.dispose();
      },
    };
  }, [element]);

  useLayoutEffect(() => {
    latest.current = input;
    motion.update({ ...input, visible: !document.hidden });
  });
  useLayoutEffect(() => {
    const visibility = () => motion.update({ ...latest.current, visible: !document.hidden });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      motion.dispose();
    };
  }, [motion]);
}
