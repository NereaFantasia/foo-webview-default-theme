import { Tooltip } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import styles from './ScrollingTitle.module.css';

/**
 * 溢出时来回滚动的一行字：开头停 2 秒，每秒 36 像素滚到末尾，停 1 秒再同速滚回。只移动文字，裁切层和
 * 相邻控件保持原位；每行按自己的实际溢出距离计时。字号与颜色由 `className` 给。
 */
export function ScrollingTitle({
  text,
  className,
  primary = false,
}: {
  readonly text: string;
  readonly className: string;
  readonly primary?: boolean;
}) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const clip = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const outer = clip.current;
    const line = inner.current;
    if (!outer || !line || reduced) return;
    let animation: Animation | undefined;
    let hovered = false;
    let focused = false;
    const pause = () => {
      if (hovered || focused || document.hidden) animation?.pause();
      else animation?.play();
    };
    const measure = () => {
      animation?.cancel();
      animation = undefined;
      const distance = line.scrollWidth - outer.clientWidth;
      if (distance <= 2) return;
      const travel = (distance / 36) * 1000;
      const duration = 3000 + travel * 2;
      animation = line.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: 2000 / duration },
          { transform: `translateX(-${distance}px)`, offset: (2000 + travel) / duration },
          { transform: `translateX(-${distance}px)`, offset: (3000 + travel) / duration },
          { transform: 'translateX(0)', offset: 1 },
        ],
        { duration, iterations: Infinity, easing: 'linear' },
      );
      pause();
    };
    const enter = () => {
      hovered = true;
      pause();
    };
    const leave = () => {
      hovered = false;
      pause();
    };
    const focus = () => {
      focused = true;
      pause();
    };
    const blur = () => {
      focused = false;
      pause();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(line);
    outer.addEventListener('pointerenter', enter);
    outer.addEventListener('pointerleave', leave);
    outer.addEventListener('focusin', focus);
    outer.addEventListener('focusout', blur);
    document.addEventListener('visibilitychange', pause);
    return () => {
      observer.disconnect();
      animation?.cancel();
      outer.removeEventListener('pointerenter', enter);
      outer.removeEventListener('pointerleave', leave);
      outer.removeEventListener('focusin', focus);
      outer.removeEventListener('focusout', blur);
      document.removeEventListener('visibilitychange', pause);
    };
  }, [text, reduced]);
  return (
    <Tooltip content={text} relationship="inaccessible">
      <span
        ref={clip}
        className={`${styles.clip} ${className}`}
        tabIndex={0}
        data-primary={primary || undefined}
      >
        <span ref={inner} className={styles.text}>
          {text}
        </span>
      </span>
    </Tooltip>
  );
}
