import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { lyricsClockKey } from '../../lyrics/lyricsClock.ts';
import { lyricsDisplayKey } from '../../lyrics/lyricsDisplay.ts';
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
  /** 歌词字号档位，由预设按窗口高度选定 */
  readonly size: LyricsSize;
  /** 歌词栏是否处于活动状态。为假时暂停逐帧驱动 */
  readonly active?: boolean;
  /** 没有歌词时是否显示状态提示与操作入口。调用方只在侧栏显式展开时传入真 */
  readonly showStatus?: boolean;
  /** 工具条与容器顶部的距离（CSS 像素） */
  readonly toolbarTop: number;
}

/** 歌词栏容器的尺寸（CSS 像素，取整），随容器大小变化更新 */
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
    // 挂载时先同步测量一次。ResizeObserver 的首次回调是异步的，不测量时首帧尺寸为 0×0，布局会闪动
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, ref] as const;
}

/**
 * 沉浸视图的歌词栏，顶部是歌词工具条
 *
 * 有时间轴的歌词由歌词播放器显示，可以跳转播放位置时，点击歌词行即跳到该行。
 * 播放器对读屏软件隐藏，读屏软件读取另一份纯文本，其中按偏好附上译文与音译。
 * 没有时间轴的歌词按纯文本排版。两者都使用沉浸视图的显示偏好与动效，字号随栏宽缩放。
 * 没有歌词时，`showStatus` 为真才显示空状态
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
  const displayService = useService(lyricsDisplayKey);
  const effects = useAtomValueRawSync(useService(lyricsMotionKey).views.immersive.motion);
  const display = useAtomValueRawSync(displayService.immersiveDisplay);
  const { positionMode } = useAtomValueRawSync(displayService.views.immersive);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const { clock, seek } = useService(lyricsClockKey);
  const [box, ref] = useColumnBox();
  const ratio = anchorRatio(box.height);
  // 位置方式为版式时，当前行位置按栏高计算。自定义位置沿用动效参数中已合成的锚点与比例
  const motion = useMemo(
    () =>
      positionMode === 'layout'
        ? { ...effects, alignAnchor: 'top' as const, alignPosition: ratio }
        : effects,
    [effects, positionMode, ratio],
  );
  const base = lyricsFontSize(size, box.width);
  // 字体与字重已按沉浸视图的字体来源解析，播放器与纯文本使用同一份
  const { fontFamily: family, fontWeight: weight } = display;
  const scaled = useMemo(() => scaleDisplay(display, base), [display, base]);
  const ready = state.status === 'ready' ? state : null;
  const readyKey = ready?.key ?? null;
  const body = useRef<HTMLDivElement>(null);
  // 歌词就绪或换曲时，正文以 83 ms 线性淡入
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
      fontFamily={family}
      fontWeight={weight}
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
