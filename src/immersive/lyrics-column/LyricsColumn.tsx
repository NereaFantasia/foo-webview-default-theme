import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { lyricsClockKey } from '../../lyrics/lyricsClock.ts';
import { lyricsDisplayKey, lyricsFontFamily } from '../../lyrics/lyricsDisplay.ts';
import { lyricsMotionKey } from '../../lyrics/lyricsMotion.ts';
import { lyricsKey } from '../../lyrics/lyricsService.ts';
import { LyricsPlainText } from '../../lyrics/LyricsPlainText.tsx';
import { LyricsPlayer } from '../../lyrics/LyricsPlayer.tsx';
import { motionDuration, CURVE, DURATION_MS } from '../../motion/timing.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackCanSeekAtom } from '../../playback/playerAtoms.ts';
import styles from './LyricsColumn.module.css';
import { LyricsEmpty } from './LyricsEmpty.tsx';
import { LyricsToolbar } from './LyricsToolbar.tsx';
import {
  anchorRatio,
  LYRICS_EDGE,
  LYRICS_MAX_WIDTH,
  lyricsFontSize,
  scaleDisplay,
  type LyricsSize,
} from './lyricsLayout.ts';
import { toolbarRoomOf } from './lyricsToolbar.ts';

export interface LyricsColumnProps {
  /** 歌词字号档位，由预设模板按窗口高度映射分配 */
  readonly size: LyricsSize;
  /** 歌词栏激活与可见性标志；非激活时挂起逐帧驱动 */
  readonly active?: boolean;
  /** 无歌词时是否渲染状态提示与操作引导（仅在侧栏显式展开时开启） */
  readonly showStatus?: boolean;
  /** 工具条距容器顶部偏移量（CSS 像素） */
  readonly toolbarTop: number;
}

/** 监听并返回歌词栏容器整块像素尺寸 */
function useColumnBox() {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      setBox((last) => (last.width === width && last.height === height ? last : { width, height }));
    };
    // 挂载时同步测量一次，避免 ResizeObserver 异步首帧 0×0 导致布局闪烁
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, ref] as const;
}

/**
 * 沉浸模式歌词栏核心容器
 *
 * 承载逐行/逐字动态歌词播放器与纯文本降级渲染，遵循用户的字体、对齐、译文与动效偏好；
 * 采用自适应视心中轴比例与字号同比缩放，支持点击行寻道与滚轮悬停浏览，动画层对读屏器隐藏并提供专用可访问文本结构；
 * 无歌词时根据侧栏展开状态决定留白或展示空状态引导，顶部挂载统一歌词工具栏
 */
export function LyricsColumn({
  size,
  active = true,
  showStatus = false,
  toolbarTop,
}: LyricsColumnProps) {
  const t = useAtomValueRawSync(translateAtom);
  const lyrics = useService(lyricsKey);
  const state = useAtomValueRawSync(lyrics.state);
  const offset = useAtomValueRawSync(lyrics.offset);
  const effects = useAtomValueRawSync(useService(lyricsMotionKey).motion);
  const display = useAtomValueRawSync(useService(lyricsDisplayKey).display);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const { clock, seek } = useService(lyricsClockKey);
  const [box, ref] = useColumnBox();
  const ratio = anchorRatio(box.height);
  const motion = useMemo(
    () => ({ ...effects, alignAnchor: 'top' as const, alignPosition: ratio }),
    [effects, ratio],
  );
  const base = lyricsFontSize(size, box.width);
  const scaled = useMemo(() => scaleDisplay(display, base), [display, base]);
  const ready = state.status === 'ready' ? state : null;
  const readyKey = ready?.key ?? null;
  const body = useRef<HTMLDivElement>(null);
  // 歌词就绪或切歌：执行 83 ms 纯淡入过渡
  useLayoutEffect(() => {
    if (readyKey === null) return;
    const animation = body.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration(DURATION_MS.faster, reduced),
      easing: CURVE.linear.timing,
    });
    return () => animation?.cancel();
  }, [readyKey, reduced]);
  const onSeek = useCallback((key: string) => (seconds: number) => void seek(key, seconds), [seek]);
  const style: CSSProperties & Record<`--${string}`, string> = {
    '--amll-lp-width': `min(100%, ${LYRICS_MAX_WIDTH}px)`,
    '--lyrics-edge-start': `${LYRICS_EDGE.start}px`,
    '--lyrics-edge-end': `${LYRICS_EDGE.end}px`,
    '--lyrics-max-width': `${LYRICS_MAX_WIDTH}px`,
    '--lyrics-toolbar-top': `${toolbarTop}px`,
    '--lyrics-toolbar-room': `${toolbarRoomOf(box.height, toolbarTop)}px`,
  };
  const plain = (lines: readonly string[]) => (
    <LyricsPlainText
      lines={lines}
      fontSize={scaled.fontSize}
      fontFamily={lyricsFontFamily(display.fontFamily)}
      align={display.align}
    />
  );
  return (
    <div
      ref={ref}
      className={styles.column}
      style={style}
      role="region"
      aria-label={t('lyrics.region')}
      data-scene-element="lyrics"
      data-lyrics-status={state.status}
    >
      <div ref={body} className={styles.body}>
        {ready?.content.kind === 'synced' ? (
          <>
            <div className={styles.animation} aria-hidden>
              <LyricsPlayer
                key={ready.key}
                lines={ready.content.lines}
                fallback={plain(
                  ready.content.lines.map((line) => line.words.map((word) => word.word).join('')),
                )}
                motion={motion}
                clock={clock}
                active={active}
                fontSize={scaled.fontSize}
                display={scaled}
                offset={offset}
                onSeek={canSeek ? onSeek(ready.key) : undefined}
                scheme="dark"
              />
            </div>
            <div className={styles.screenReaderText}>
              {ready.content.lines.map((line, index) => (
                <p key={index}>
                  {line.words.map((word) => word.word).join('')}
                  {display.showTranslation && line.translatedLyric && (
                    <span> {line.translatedLyric}</span>
                  )}
                  {display.showRomanization && line.romanLyric && <span> {line.romanLyric}</span>}
                </p>
              ))}
            </div>
          </>
        ) : ready ? (
          <div className={styles.reading}>{plain(ready.content.lines)}</div>
        ) : showStatus ? (
          <LyricsEmpty state={state} />
        ) : null}
      </div>
      <LyricsToolbar active={active} />
    </div>
  );
}
