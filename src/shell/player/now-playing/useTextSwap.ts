import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { textSwapMotion, type MotionTrack, type TextMotion } from './swapMotion.ts';
import { trackSwapAtom } from './trackSwap.ts';

function play(elements: readonly HTMLElement[], tracks: readonly MotionTrack[]): Animation[] {
  // 退场停在终态（透明）等换字，换字与进场在同一帧里接上，中间不露出旧字。
  return elements.flatMap((element) =>
    tracks.map(([frames, timing]) => element.animate(frames, { ...timing, fill: 'forwards' })),
  );
}

/**
 * 换曲时文字先退后进（节奏见 `swapMotion.ts`）。`live` 是此刻该写的内容（曲目，正在播放条还带格式标记），
 * 返回这一帧实际写的：退场期间还是上一首的，退场放完才换成新的，同时放进场。`targets` 是要动的那几块，
 * 放完即止、不留变换。
 *
 * 不做过渡、直接换的情况：`enabled` 为假（进度条悬停态里字本来就糊着）、减弱动效、页面不可见（最小化时
 * 动画不走，字会一直停在上一首）。上一轮还没放完又换了曲：省掉退场，直接写最新的一首、放进场，不把中间
 * 几首都演一遍。组件挂上时不补放：只有挂上之后的换曲才动。
 */
export function useTextSwap<T>(
  live: T,
  targets: readonly RefObject<HTMLElement | null>[],
  enabled: boolean,
): T {
  const swap = useAtomValueRawSync(trackSwapAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [held, setHeld] = useState<{ readonly value: T } | null>(null);
  const [state] = useState(() => ({
    handled: swap.serial,
    running: [] as Animation[],
    enter: null as TextMotion | null,
  }));
  // 上一次提交时写在界面上的内容：换曲那一刻它还是上一首的，退场期间照它写。
  const shown = useRef(live);

  useLayoutEffect(() => {
    const elements = targets.flatMap((target) => (target.current ? [target.current] : []));
    const stop = () => {
      for (const animation of state.running) animation.cancel();
      state.running = [];
    };
    const enter = (motion: TextMotion) => {
      stop();
      const current = play(elements, motion.enter);
      state.running = current;
      void Promise.all(current.map((animation) => animation.finished)).then(
        () => {
          if (state.running !== current) return;
          for (const animation of current) animation.cancel();
          state.running = [];
        },
        () => undefined,
      );
    };

    if (swap.serial !== state.handled) {
      state.handled = swap.serial;
      const busy = state.running.length > 0 || held !== null;
      const motion = textSwapMotion(swap);
      stop();
      state.enter = null;
      const still =
        !enabled || reduced || document.visibilityState !== 'visible' || elements.length === 0;
      if (still) {
        if (held) setHeld(null);
      } else if (busy) {
        // 退场期间又换了：先把字换成最新的，下一次提交时放进场。
        if (held) {
          state.enter = motion;
          setHeld(null);
        } else enter(motion);
      } else {
        setHeld({ value: shown.current });
        const current = play(elements, motion.exit);
        state.running = current;
        void Promise.all(current.map((animation) => animation.finished)).then(
          () => {
            if (state.running !== current) return;
            state.enter = motion;
            setHeld(null);
          },
          () => undefined,
        );
      }
    } else if (state.enter && !held) {
      const motion = state.enter;
      state.enter = null;
      enter(motion);
    }
    shown.current = held ? held.value : live;
  }, [targets, swap, state, held, live, enabled, reduced]);

  useLayoutEffect(
    () => () => {
      for (const animation of state.running) animation.cancel();
      state.running = [];
    },
    [state],
  );

  return held ? held.value : live;
}
