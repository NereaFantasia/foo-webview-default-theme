import {
  DomLyricPlayer,
  LayoutReason,
  LyricLineMouseEvent,
  type LyricLine,
} from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { startLyricsDriver, type LyricsClockFace, type LyricsDriver } from './lyricsDriver.ts';
import type { LyricsMotion } from './lyricsMotion.ts';
import {
  alignLyricLines,
  lyricsFontFamily,
  lyricsProcessConfig,
  type LyricsDisplay,
} from './lyricsDisplay.ts';
import { prepareLyricsLines } from './lyricsTiming.ts';
import styles from './LyricsPlayer.module.css';

export interface LyricsPlayerProps {
  /** 带时间轴的歌词；换一份就整份重排，滚动位置跟当前播放位置走 */
  readonly lines: readonly LyricLine[];
  /** 时间无法修复或播放器出错时显示的文字视图 */
  readonly fallback: ReactNode;
  readonly motion: LyricsMotion;
  readonly clock: LyricsClockFace;
  /** 歌词区看得见时为真；看不见时停帧，省下每帧的排版 */
  readonly active: boolean;
  /** 正文字号，CSS 像素 */
  readonly fontSize: number;
  readonly display?: LyricsDisplay;
  readonly offset?: number;
  /** 点了某一行：交回那一行的开始时间，秒 */
  readonly onSeek?: (seconds: number) => void;
  /** 禁止手动滚动时回到播放行，不保留此前的手动滚动偏移 */
  readonly scrollable?: boolean;
  /** 所在表面固定的深浅；不给就跟整窗。沉浸视图的预设场景固定深色，不随整窗的浅色变 */
  readonly scheme?: 'light' | 'dark';
}

const curve = ([x1, y1, x2, y2]: LyricsMotion['transitionCurve']) =>
  `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;

/**
 * AMLL 的歌词播放器（只用 DOM 播放器，不用它的背景层）。播放器与驱动随组件建、随卸载释放；
 * 减弱动效时关掉弹簧、模糊与缩放，行的移动不再过渡
 */
export function LyricsPlayer(props: LyricsPlayerProps) {
  const { lines, fallback } = props;
  const prepared = useMemo(() => prepareLyricsLines(lines), [lines]);
  const [session, setSession] = useState({ lines, failed: false, revision: 0 });
  if (session.lines !== lines) setSession({ lines, failed: false, revision: session.revision + 1 });
  const onError = useCallback(
    (error: unknown) => {
      console.warn('歌词同步显示失败', error);
      setSession((current) => (current.lines === lines ? { ...current, failed: true } : current));
    },
    [lines],
  );
  return prepared && !session.failed ? (
    <AnimatedLyrics key={session.revision} {...props} lines={prepared} onError={onError} />
  ) : (
    <div className={styles.root} data-lyrics-fallback>
      {fallback}
    </div>
  );
}

interface AnimatedLyricsProps extends LyricsPlayerProps {
  readonly onError: (error: unknown) => void;
}

function AnimatedLyrics({
  lines,
  motion,
  clock,
  active,
  fontSize,
  display,
  offset = 0,
  onSeek,
  scrollable = true,
  scheme: fixedScheme,
  onError,
}: AnimatedLyricsProps) {
  const host = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<DomLyricPlayer | null>(null);
  const driver = useRef<LyricsDriver | null>(null);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const followedScheme = useAtomValueRawSync(colorSchemeAtom);
  const scheme = fixedScheme ?? followedScheme;
  const align = display?.align ?? 'left';
  const seek = useRef(onSeek);
  seek.current = onSeek;
  const guard = useMemo(() => {
    let failed = false;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      onError(error);
    };
    return {
      fail,
      run<T>(action: () => T): T | undefined {
        if (failed) return undefined;
        try {
          return action();
        } catch (error) {
          fail(error);
          return undefined;
        }
      },
      release(action: () => void) {
        try {
          action();
        } catch (error) {
          console.warn('歌词播放器资源释放失败', error);
        }
      },
    };
  }, [onError]);

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return undefined;
    const created = guard.run(() => new DomLyricPlayer());
    if (!created) return undefined;
    // AMLL 挂入虚拟行后先测量再写位置；非弹簧模式会把这次定位误播成从顶部落下的过渡
    const inserted = new MutationObserver((records) => {
      guard.run(() => {
        if (created.getEnableSpring()) return;
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement) || !node.className.includes('lyricLineWrapper'))
              continue;
            for (const animation of node.getAnimations()) {
              if (
                animation instanceof CSSTransition &&
                animation.transitionProperty === 'transform'
              )
                animation.finish();
            }
          }
        }
      });
    });
    let started: LyricsDriver | undefined;
    const onLine = (event: Event) => {
      if (event instanceof LyricLineMouseEvent)
        seek.current?.(event.line.getLine().startTime / 1000);
    };
    guard.run(() => {
      parent.append(created.getElement());
      inserted.observe(created.getElement(), { childList: true });
      started = startLyricsDriver(created, clock, undefined, guard.fail);
      created.addEventListener('line-click', onLine);
      driver.current = started;
      setPlayer(created);
    });
    return () => {
      created.removeEventListener('line-click', onLine);
      inserted.disconnect();
      guard.release(() => started?.dispose());
      driver.current = null;
      guard.release(() => created.dispose());
      guard.release(() => created.getElement().remove());
      setPlayer(null);
    };
  }, [clock, guard]);

  useEffect(() => {
    guard.run(() => player?.setLyricLines(alignLyricLines(lines, align), clock.position() * 1000));
  }, [player, lines, align, clock, guard]);

  useEffect(() => {
    if (!player) return;
    guard.run(() => {
      player.setEnableSpring(motion.spring && !reduced);
      player.setEnableScale(motion.scale && !reduced);
      player.setEnableBlur(motion.blur && !reduced);
      player.setHidePassedLines(motion.hidePassedLines);
      player.setWordFadeWidth(motion.wordFadeWidth);
      player.setLineScaleSpringParams(motion.scaleSpring);
      player.setAlignAnchor(motion.alignAnchor);
      player.setAlignPosition(motion.alignPosition);
      player.calcLayout(LayoutReason.ConfigChange);
    });
  }, [player, lines, align, motion, reduced, guard]);

  useEffect(() => {
    if (!player || !display) return;
    guard.run(() => {
      player.setEnableAutoSeekDetection(display.autoSeek);
      player.setOverscanPx(display.overscan);
      player.setAlwaysPostpositionBackground(display.backgroundLast);
      player.updateLyricProcessConfig(lyricsProcessConfig(display));
      // 整理配置重建歌词行时，AMLL 会恢复缩放弹簧缺省值；重建后重新套用当前档位
      player.setLineScaleSpringParams(motion.scaleSpring);
    });
  }, [player, display, motion.scaleSpring, guard]);

  useEffect(() => {
    driver.current?.setOffset(offset);
  }, [player, offset, lines]);

  useEffect(() => {
    driver.current?.setActive(active && player !== null);
  }, [player, active]);

  useEffect(() => {
    if (!player || scrollable) return;
    guard.run(() => {
      player.resetScroll();
      player.calcLayout(LayoutReason.Seek);
    });
  }, [player, scrollable, guard]);

  useLayoutEffect(() => {
    if (!player) return;
    guard.run(() => player.calcLayout(LayoutReason.ConfigChange));
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) guard.run(() => player.calcLayout(LayoutReason.ConfigChange));
    });
    return () => {
      cancelled = true;
    };
  }, [
    player,
    fontSize,
    display?.fontFamily,
    display?.translationFontSize,
    display?.showTranslation,
    display?.showRomanization,
    guard,
  ]);

  const style: CSSProperties & Record<`--${string}`, string> = {
    fontFamily: lyricsFontFamily(display?.fontFamily ?? ''),
    '--amll-lp-font-size': `${fontSize}px`,
    '--lyrics-transition-duration': `${reduced ? 0 : motion.transitionMs}ms`,
    '--lyrics-transition-curve': curve(motion.transitionCurve),
    ...(display?.translationFontSize != null
      ? { '--lyrics-translation-size': `${display.translationFontSize}px` }
      : {}),
  };
  return (
    <div
      ref={host}
      onWheelCapture={(event) => {
        if (!scrollable) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={styles.root}
      style={style}
      data-scheme={scheme}
      data-lyrics-align={align}
      data-spring={motion.spring && !reduced ? 'on' : 'off'}
      data-reduced-motion={reduced || undefined}
      data-translation={display?.showTranslation === false ? 'hidden' : undefined}
      data-romanization={display?.showRomanization === false ? 'hidden' : undefined}
    />
  );
}
