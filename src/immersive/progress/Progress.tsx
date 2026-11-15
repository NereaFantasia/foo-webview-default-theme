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
 * 当前曲目播放进度展示与控制组件：包含 6px 进度槽线及下方已播放/总时长文本。
 * 点击即时跳转至目标进度，拖拽交互于释放指针时提交跳转，拖拽过程中支持 Esc 键或右键取消，
 * 方向键每次 5 秒，Home 回到开头。不能 seek 的（网络流等）不接收指针与键盘。
 * 交互手势识别、播放头逐帧插值与无障碍属性由底层 `SeekBar` 驱动，本组件负责槽线与时间排版。
 * 无活动曲目时保持空轨占位高度以避免换曲引发界面抖动。
 *
 * 悬停、拖拽或键盘寻道时提供进度预览指示：在槽线上渲染垂直位置标线。
 * 目标时间与歌词预览模式由 `preview` 属性决定：
 * - `popover`（缺省）：于标线上方弹出气泡浮层（`SeekLyricsPopover`），没有带时间轴的歌词时仅显示时间
 * - `inline`：不弹浮层，歌词直接浮在槽线上方，压在上面的内容上、不占位，与标题栏、胶囊态播放栏的预览是同一套（`SeekLyrics`）
 *
 * 内联预览激活时由外层容器对上方内容施加模糊弱化效果，本组件提供 `data-previewing` 状态属性。
 * 宽度由外层容器决定。`SeekBar` 的命中区在槽线上下各延伸 8px，下面的时间行不接收指针，组件高度包含命中区
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
          preview={inline ? undefined : (target) => <SeekLyricsPopover target={target} />}
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
  /** 预览时间与歌词的呈现模式：`popover` 采用线上方弹出气泡（缺省），`inline` 采用直接悬浮于槽线上方覆盖 */
  readonly preview?: 'popover' | 'inline';
}

/**
 * 进度槽线与时间排版子组件。
 * `inline` 模式下额外渲染内联歌词预览层（`SeekLyrics`），浮动覆盖上方内容并通过 `data-previewing` 通知外层淡化。
 * 预览时左侧的已播时间换成预览位置的时间，取主文字色（`--text-primary`）
 */
function Line({ display, inline }: { readonly display: SeekBarDisplay; readonly inline: boolean }) {
  const previewing = display.preview !== null;
  return (
    <>
      {inline && (
        <div className={styles.overlay} data-previewing={previewing || undefined}>
          <SeekLyrics target={display.preview} />
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

/** 预览目标位置标线：非预览状态执行平滑淡出并保持停靠，指针移动过程中跳过过渡动画 */
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
