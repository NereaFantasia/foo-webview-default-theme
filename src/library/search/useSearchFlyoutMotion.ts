import { useLayoutEffect, useRef, useState } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { CURVE, DURATION_MS, motionDuration } from '../../motion/timing.ts';

export function useSearchFlyoutMotion(open: boolean) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const panel = useRef<HTMLDivElement>(null);
  const interrupted = useRef<Keyframe | null>(null);
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !present) return;
    const running = element.getAnimations();
    const style = getComputedStyle(element);
    const opacity =
      interrupted.current?.opacity ?? (running.length ? style.opacity : open ? '0' : '1');
    const transform =
      interrupted.current?.transform ??
      (running.length ? style.transform : open ? 'translateY(-10px)' : 'none');
    const clipPath =
      interrupted.current?.clipPath ??
      (running.length ? style.clipPath : open ? 'inset(0 0 50% 0)' : 'inset(0)');
    interrupted.current = null;
    for (const animation of running) animation.cancel();
    const skip = reduced || document.visibilityState !== 'visible';
    const fade = element.animate([{ opacity }, { opacity: open ? 1 : 0 }], {
      duration: motionDuration(DURATION_MS.faster, skip),
      easing: CURVE.linear.timing,
      fill: 'both',
    });
    const slide = element.animate(
      [
        { transform, clipPath },
        {
          transform: open ? 'none' : 'translateY(-10px)',
          clipPath: open ? 'inset(0)' : 'inset(0 0 50% 0)',
        },
      ],
      {
        duration: motionDuration(open ? DURATION_MS.normal : DURATION_MS.fast, skip),
        easing: CURVE.decelerateMid.timing,
        fill: 'both',
      },
    );
    let current = true;
    void Promise.allSettled([fade.finished, slide.finished]).then(() => {
      if (!current) return;
      current = false;
      if (!open) setPresent(false);
      else {
        fade.cancel();
        slide.cancel();
      }
    });
    const hidden = () => {
      if (document.visibilityState !== 'visible') {
        fade.finish();
        slide.finish();
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      if (current) {
        const frame = getComputedStyle(element);
        interrupted.current = {
          opacity: frame.opacity,
          transform: frame.transform,
          clipPath: frame.clipPath,
        };
      }
      current = false;
      document.removeEventListener('visibilitychange', hidden);
      fade.cancel();
      slide.cancel();
    };
  }, [open, present, reduced]);
  return { panel, present };
}
