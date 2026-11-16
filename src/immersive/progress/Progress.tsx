import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { SeekLyrics, SeekLyricsPopover } from '../../lyrics/SeekLyrics.tsx';
import { CURVE, DURATION_MS } from '../../motion/timing.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { SeekBar, type SeekBarDisplay } from '../../playback/seek/SeekBar.tsx';
import { clockText } from '../../playback/seekDraft.ts';
import { trackSwapAtom } from '../../playback/now-playing/trackSwap.ts';
import styles from './Progress.module.css';

/**
 * 沉浸视图中当前曲目的进度条：6px 的进度槽，下方是已播放时间与总时长
 *
 * 点击立即跳转。拖动时在松开指针时跳转，拖动过程中按 Esc 或右键可取消。方向键每次移动 5 秒，Home 回到开头。
 * 不能跳转的曲目（如网络流）不接收指针与键盘。
 * 手势识别、播放头的逐帧插值与无障碍属性由 `SeekBar` 负责，本组件负责进度槽与时间的排版。
 * 没有曲目时保留空进度槽的高度，换曲时布局不跳动。
 *
 * 悬停、拖动或用键盘调整位置时，进度槽上显示一条竖线标出预览位置。目标时间与歌词的预览方式由 `preview` 决定：
 * - `popover`（缺省）：在竖线上方弹出气泡（`SeekLyricsPopover`），没有带时间轴的歌词时只显示时间
 * - `inline`：不弹出气泡，歌词直接浮在进度槽上方，覆盖上方内容且不占位，与标题栏、胶囊形播放栏的预览相同（`SeekLyrics`）
 *
 * 内联预览进行时，外层容器模糊并减弱上方内容，本组件为此提供 `data-previewing` 属性。
 * 宽度由外层容器决定。`SeekBar` 的命中区在进度槽上下各延伸 8px，下面的时间行不接收指针，组件高度包含命中区
 */
export function Progress({ preview = 'popover' }: ProgressProps) {
  const { track } = useAtomValueRawSync(playbackAtom);
  const root = useRef<HTMLDivElement>(null);
  useFadeOnSwap(root);
  const inline = preview === 'inline';
  return (
    <div ref={root} className={styles.progress} data-scene-element="progress">
      {track ? (
        <SeekBar
          interactive
          thickness={6}
          preview={
            inline ? undefined : (target) => <SeekLyricsPopover target={target} view="immersive" />
          }
        >
          {(display) => <Line display={display} inline={inline} />}
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

export interface ProgressProps {
  /** 预览时间与歌词的方式，见 `Progress` */
  readonly preview?: 'popover' | 'inline';
}

/**
 * 进度槽与时间行。`inline` 时另外渲染浮在上方的歌词预览（`SeekLyrics`），并以 `data-previewing` 通知外层减弱上方内容。
 * `inline` 预览时，左侧的已播放时间改为预览位置的时间，使用主文字色（`--text-primary`）
 */
function Line({ display, inline }: { readonly display: SeekBarDisplay; readonly inline: boolean }) {
  const previewing = display.preview !== null;
  return (
    <>
      {inline && (
        <div className={styles.overlay} data-previewing={previewing || undefined}>
          <SeekLyrics target={display.preview} view="immersive" />
        </div>
      )}
      <div className={styles.rail}>
        {display.track}
        <PreviewMarker fraction={display.preview?.fraction ?? null} />
      </div>
      <div className={`${styles.times} ${styles.hanging}`} aria-hidden>
        <span data-seek-clock="position" data-previewing={(inline && previewing) || undefined}>
          {clockText(inline && display.preview ? display.preview.seconds : display.position)}
        </span>
        <span data-seek-clock="duration">
          {display.duration > 0 ? clockText(display.duration) : ''}
        </span>
      </div>
    </>
  );
}

/** 预览位置的竖线。预览结束时在原位淡出，指针移动过程中位置变化不播放过渡 */
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
 * 换曲时进度条与时间随曲名一起以 83 ms 线性淡入
 *
 * 减弱动效或页面不可见时不播放动画，首次挂载也不播放
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
