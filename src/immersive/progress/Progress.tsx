import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { SeekLyricsPopover } from '../../lyrics/SeekLyrics.tsx';
import { CURVE, DURATION_MS } from '../../motion/timing.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { SeekBar, type SeekBarDisplay } from '../../playback/seek/SeekBar.tsx';
import { clockText } from '../../playback/seekDraft.ts';
import { trackSwapAtom } from '../../playback/now-playing/trackSwap.ts';
import styles from './Progress.module.css';

/**
 * 当前曲目的进度：一条 6 高的线，线下左边写播到的时间、右边写总长。点哪跳哪，拖动松手才跳，拖动中 Esc 或右键放弃，
 * ← → 各 5 秒、Home 回开头；不能 seek 的（网络流等）不接指针与键。手势、播放头逐帧插值与无障碍值都在
 * `SeekBar`，这里只摆线与时间。没有曲目时画一条空轨，高度不变，换曲时下面的件不上下跳
 *
 * 悬停、拖动与键盘移动时预览要去的位置：线上画一条竖标，线不变粗；竖标上方弹出那一刻的时间与歌词
 * （`SeekLyricsPopover`，没有带时间轴的歌词时只有时间）
 *
 * 宽度由外面给；`SeekBar` 的命中区只有线上下各 8，下面的时间行不接指针，元素的高度含它们
 */
export function Progress() {
  const { track } = useAtomValueRawSync(playbackAtom);
  const root = useRef<HTMLDivElement>(null);
  useFadeOnSwap(root);
  return (
    <div ref={root} className={styles.progress} data-scene-element="progress">
      {track ? (
        <SeekBar
          interactive
          thickness={6}
          preview={(target) => <SeekLyricsPopover target={target} />}
        >
          {(display) => <Line display={display} />}
        </SeekBar>
      ) : (
        <div className={styles.rest}>
          <div className={styles.empty} />
          <div className={styles.times} />
        </div>
      )}
    </div>
  );
}

function Line({ display }: { readonly display: SeekBarDisplay }) {
  return (
    <>
      <div className={styles.rail}>
        {display.track}
        <PreviewMarker fraction={display.preview?.fraction ?? null} />
      </div>
      <div className={`${styles.times} ${styles.hanging}`} aria-hidden>
        <span data-seek-clock="position">{clockText(display.position)}</span>
        <span data-seek-clock="duration">
          {display.duration > 0 ? clockText(display.duration) : ''}
        </span>
      </div>
    </>
  );
}

/** 预览位置的竖标：不预览时淡出，淡出期间留在原处；跟着指针移动时不加过渡 */
function PreviewMarker({ fraction }: { readonly fraction: number | null }) {
  const [shown, setShown] = useState(0);
  if (fraction !== null && fraction !== shown) setShown(fraction);
  return (
    <span
      className={styles.marker}
      data-seek-preview
      data-visible={fraction !== null || undefined}
      style={{ left: `${shown * 100}%` }}
      aria-hidden
    />
  );
}

/**
 * 切歌平滑过渡淡入 hook
 *
 * 曲目切换时进度条与时间读数随曲名同步执行线性淡入（83ms）；播放头避免倒滑复位；
 * 动效降级或页面处于隐藏状态时直接就位，初始挂载跳过动画
 */
function useFadeOnSwap(target: RefObject<HTMLElement | null>): void {
  const swap = useAtomValueRawSync(trackSwapAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const handled = useRef(swap.serial);
  useLayoutEffect(() => {
    if (swap.serial === handled.current) return;
    handled.current = swap.serial;
    const element = target.current;
    if (!element || reduced || document.visibilityState !== 'visible') return;
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: DURATION_MS.faster,
      easing: CURVE.linear.timing,
    });
    return () => animation.cancel();
  }, [swap, reduced, target]);
}
