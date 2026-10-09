import {
  DomLyricPlayer,
  LayoutReason,
  LyricLineMouseEvent,
  type LyricLine,
} from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { startLyricsDriver, type LyricsClockFace, type LyricsDriver } from './lyricsDriver.ts';
import type { LyricsMotion } from './lyricsMotion.ts';
import { lyricsFontFamily, lyricsProcessConfig, type LyricsDisplay } from './lyricsDisplay.ts';
import styles from './LyricsPlayer.module.css';

export interface LyricsPlayerProps {
  /** 带时间轴的歌词；换一份就整份重排，滚动位置跟当前播放位置走。 */
  readonly lines: readonly LyricLine[];
  readonly motion: LyricsMotion;
  readonly clock: LyricsClockFace;
  /** 歌词区看得见时为真；看不见时停帧，省下每帧的排版。 */
  readonly active: boolean;
  /** 正文字号，CSS 像素。 */
  readonly fontSize: number;
  readonly display?: LyricsDisplay;
  readonly offset?: number;
  /** 点了某一行：交回那一行的开始时间，秒。 */
  readonly onSeek?: (seconds: number) => void;
}

const curve = ([x1, y1, x2, y2]: LyricsMotion['transitionCurve']) =>
  `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;

/**
 * AMLL 的歌词播放器（只用 DOM 播放器，不用它的背景层）。播放器与驱动随组件建、随卸载释放；
 * 减弱动效时关掉弹簧、模糊与缩放，行的移动不再过渡。
 */
export function LyricsPlayer({
  lines,
  motion,
  clock,
  active,
  fontSize,
  display,
  offset = 0,
  onSeek,
}: LyricsPlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<DomLyricPlayer | null>(null);
  const driver = useRef<LyricsDriver | null>(null);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const seek = useRef(onSeek);
  seek.current = onSeek;

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return undefined;
    const created = new DomLyricPlayer();
    parent.append(created.getElement());
    // AMLL 挂入虚拟行后先测量再写位置；非弹簧模式会把这次定位误播成从顶部落下的过渡。
    const inserted = new MutationObserver((records) => {
      if (created.getEnableSpring()) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.className.includes('lyricLineWrapper'))
            continue;
          for (const animation of node.getAnimations()) {
            if (animation instanceof CSSTransition && animation.transitionProperty === 'transform')
              animation.finish();
          }
        }
      }
    });
    inserted.observe(created.getElement(), { childList: true });
    const started = startLyricsDriver(created, clock);
    const onLine = (event: Event) => {
      if (event instanceof LyricLineMouseEvent)
        seek.current?.(event.line.getLine().startTime / 1000);
    };
    created.addEventListener('line-click', onLine);
    driver.current = started;
    setPlayer(created);
    return () => {
      created.removeEventListener('line-click', onLine);
      inserted.disconnect();
      started.dispose();
      driver.current = null;
      created.dispose();
      created.getElement().remove();
      setPlayer(null);
    };
  }, [clock]);

  useEffect(() => {
    // AMLL 收可变数组，复制一份，不让它改到调用方的数据。
    player?.setLyricLines(
      lines.map((line) => ({ ...line, words: [...line.words] })),
      clock.position() * 1000,
    );
  }, [player, lines, clock]);

  useEffect(() => {
    if (!player) return;
    player.setEnableSpring(motion.spring && !reduced);
    player.setEnableScale(motion.scale && !reduced);
    player.setEnableBlur(motion.blur && !reduced);
    player.setHidePassedLines(motion.hidePassedLines);
    player.setWordFadeWidth(motion.wordFadeWidth);
    player.setLineScaleSpringParams(motion.scaleSpring);
    player.setAlignAnchor(motion.alignAnchor);
    player.setAlignPosition(motion.alignPosition);
    player.calcLayout(LayoutReason.ConfigChange);
  }, [player, lines, motion, reduced]);

  useEffect(() => {
    if (!player || !display) return;
    player.setEnableAutoSeekDetection(display.autoSeek);
    player.setOverscanPx(display.overscan);
    player.setAlwaysPostpositionBackground(display.backgroundLast);
    player.updateLyricProcessConfig(lyricsProcessConfig(display));
    // 整理配置重建歌词行时，AMLL 会恢复缩放弹簧缺省值；重建后重新套用当前档位。
    player.setLineScaleSpringParams(motion.scaleSpring);
  }, [player, display, motion.scaleSpring]);

  useEffect(() => {
    driver.current?.setOffset(offset);
  }, [player, offset, lines]);

  useEffect(() => {
    driver.current?.setActive(active && player !== null);
  }, [player, active]);

  useLayoutEffect(() => {
    if (!player) return;
    player.calcLayout(LayoutReason.ConfigChange);
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) player.calcLayout(LayoutReason.ConfigChange);
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
      className={styles.root}
      style={style}
      data-scheme={scheme}
      data-spring={motion.spring && !reduced ? 'on' : 'off'}
      data-reduced-motion={reduced || undefined}
      data-translation={display?.showTranslation === false ? 'hidden' : undefined}
      data-romanization={display?.showRomanization === false ? 'hidden' : undefined}
    />
  );
}
