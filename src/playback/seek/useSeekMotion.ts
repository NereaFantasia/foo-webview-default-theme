import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { createSeekMotion, type SeekMotionClock, type SeekMotionInput } from './seekMotion.ts';

/** 逐帧推进的进度：active 时帧帧按估计重画；意图缓动未播完时让位，估计也打不断它 */
export interface SeekPlayhead {
  readonly active: boolean;
  /** 按 rAF 时刻给出该显示的比例，0 到 1 */
  estimate(now: number): number;
}

/**
 * 填充与指示器共用时钟、各自保留显示位置；鼠标定位只让填充缓动，之后切换输入也从各自位置接续
 * `playhead` 开着时在两拍宿主进度事件之间逐帧重画，fill 与 indicator 同步走；宿主每拍报来的
 * 位置经 estimate 提供方对准，不在这里换算
 */
export function useSeekMotion(
  element: RefObject<HTMLElement | null>,
  input: Omit<SeekMotionInput, 'visible'>,
  playhead?: SeekPlayhead,
): void {
  const latest = useRef(input);
  const ahead = useRef(playhead);
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
    ahead.current = playhead;
    motion.update({ ...input, visible: !document.hidden });
  });
  useEffect(() => {
    if (!playhead?.active) return;
    let handle = 0;
    const frame = (now: number) => {
      handle = requestAnimationFrame(frame);
      const estimate = ahead.current?.estimate(now);
      motion.update({
        ...latest.current,
        ...(estimate === undefined ? {} : { fraction: estimate }),
        visible: !document.hidden,
      });
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [motion, playhead?.active]);
  useLayoutEffect(() => {
    const visibility = () => motion.update({ ...latest.current, visible: !document.hidden });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      motion.dispose();
    };
  }, [motion]);
}
