import { Tooltip, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useService } from '../../kit/useService.ts';
import { lyricsKey } from '../../lyrics/lyricsService.ts';
import { lyricsDisplayKey, lyricsFontFamily } from '../../lyrics/lyricsDisplay.ts';
import { createLyricsTimeline, type LyricsCue } from '../../lyrics/lyricsTimeline.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { clockText } from '../../playback/seekDraft.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { CURVE, durationVar } from '../../motion/timing.ts';
import { roleVar } from '../../theme/roles.ts';
import { textSwapMotion, type MotionTrack } from './now-playing/swapMotion.ts';
import type { SeekPreview } from './useSeekPreview.ts';
import styles from './SeekLyrics.module.css';

function useLyricsPreview(target: SeekPreview | null) {
  const lyrics = useService(lyricsKey);
  const displayService = useService(lyricsDisplayKey);
  const state = useAtomValueRawSync(lyrics.state);
  const subject = useAtomValueRawSync(lyrics.subject);
  const offset = useAtomValueRawSync(lyrics.offset);
  const display = useAtomValueRawSync(displayService.display);
  const playback = useAtomValueRawSync(playbackAtom);
  const content =
    state.status === 'ready' && state.key === trackKeyOf(playback.track) ? state.content : null;
  const timeline = useMemo(
    () =>
      content?.kind === 'synced'
        ? createLyricsTimeline(
            content.lines,
            display,
            playback.duration > 0 ? (playback.duration - offset) * 1000 : Infinity,
          )
        : null,
    [content, display, playback.duration, offset],
  );
  const scope = useMemo(
    () => ({ content, subject, offset, display, generation: playback.trackGeneration }),
    [content, subject, offset, display, playback.trackGeneration],
  );
  const visible = target !== null && target.generation === playback.trackGeneration;
  const lastTarget = useRef<SeekPreview | null>(null);
  useLayoutEffect(() => {
    if (visible) lastTarget.current = target;
  }, [visible, target]);
  useEffect(() => {
    if (visible) lyrics.requestPreview();
  }, [lyrics, visible, subject, playback.trackGeneration]);
  const retained =
    lastTarget.current?.generation === playback.trackGeneration ? lastTarget.current : null;
  const seconds = visible ? target.seconds : (retained?.seconds ?? 0);
  return {
    cue: visible ? (timeline?.at((seconds - offset) * 1000) ?? null) : null,
    scope,
    seconds,
    anchor: (visible ? target : retained)?.anchor,
    visible,
    synced: timeline !== null,
    hasSub: timeline?.hasSub ?? false,
    fontFamily: lyricsFontFamily(display.fontFamily),
  };
}

type PreviewContent = ReturnType<typeof useLyricsPreview>;

interface TextFrame {
  readonly scope: object;
  readonly cue: LyricsCue | null;
  readonly old: LyricsCue | null;
  readonly seconds: number;
  readonly serial: number;
  readonly direction: 'next' | 'previous' | 'none';
}

/** 两行作为同一组换位；连续跨句读取当前画面后接续，不排队播放经过的句子。 */
function PreviewText({ content }: { readonly content: PreviewContent }) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [frame, setFrame] = useState<TextFrame>({
    scope: content.scope,
    cue: content.cue,
    old: null,
    seconds: content.seconds,
    serial: 0,
    direction: 'none',
  });
  const changed = frame.scope !== content.scope || frame.cue?.id !== content.cue?.id;
  if (changed || frame.seconds !== content.seconds) {
    const same = frame.scope === content.scope;
    setFrame({
      scope: content.scope,
      cue: content.cue,
      old: changed ? (same ? frame.cue : null) : frame.old,
      seconds: content.seconds,
      serial: frame.serial + (changed ? 1 : 0),
      direction: !changed
        ? frame.direction
        : same && frame.cue && content.cue
          ? content.seconds >= frame.seconds
            ? 'next'
            : 'previous'
          : 'none',
    });
  }
  const incoming = useRef<HTMLDivElement>(null);
  const outgoing = useRef<HTMLDivElement>(null);
  const running = useRef<Animation[]>([]);
  const handled = useRef({ serial: -1, reduced });
  useLayoutEffect(() => {
    if (handled.current.serial === frame.serial && handled.current.reduced === reduced) return;
    handled.current = { serial: frame.serial, reduced };
    const node = incoming.current;
    const busy = running.current.some((animation) => animation.playState === 'running');
    const current = node ? getComputedStyle(node) : null;
    const from = { translate: current?.translate ?? '0 0', opacity: current?.opacity ?? '1' };
    for (const animation of running.current) animation.cancel();
    running.current = [];
    if (reduced || document.hidden) {
      if (frame.old) setFrame((value) => ({ ...value, old: null }));
      return;
    }
    const motion = textSwapMotion({
      kind: frame.direction === 'none' ? 'enter' : 'track',
      direction: frame.direction,
    });
    const play = (element: HTMLElement | null, tracks: readonly MotionTrack[], resume: boolean) => {
      if (!element) return [];
      return tracks.map(([frames, timing]) => {
        const first = frames[0] ?? {};
        const start = resume
          ? {
              ...first,
              ...('translate' in first ? { translate: from.translate } : {}),
              ...('opacity' in first ? { opacity: from.opacity } : {}),
            }
          : first;
        return element.animate([start, ...frames.slice(1)], { ...timing, fill: 'both' });
      });
    };
    const animations = [
      ...play(frame.cue ? node : null, motion.enter, busy && frame.direction !== 'none'),
      ...play(frame.old ? outgoing.current : null, motion.exit, busy),
    ];
    running.current = animations;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (running.current !== animations) return;
      animations.forEach((animation) => animation.cancel());
      running.current = [];
      setFrame((value) =>
        value.serial === frame.serial && value.old ? { ...value, old: null } : value,
      );
    });
  }, [frame, reduced]);
  useLayoutEffect(() => {
    const stop = () => {
      running.current.forEach((animation) => animation.cancel());
      running.current = [];
    };
    const visibility = () => {
      if (document.hidden) {
        stop();
        setFrame((value) => (value.old ? { ...value, old: null } : value));
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      stop();
    };
  }, []);
  const row = (cue: LyricsCue | null) => (
    <>
      <div className={styles.main}>{cue?.text}</div>
      <div className={styles.sub}>{cue?.sub}</div>
    </>
  );
  return (
    <div
      className={styles.lines}
      style={{ fontFamily: content.fontFamily }}
      aria-hidden
      data-seek-lyrics
    >
      <div ref={incoming} className={styles.row}>
        {row(frame.cue)}
      </div>
      {frame.old && (
        <div ref={outgoing} className={`${styles.row} ${styles.outgoing}`}>
          {row(frame.old)}
        </div>
      )}
    </div>
  );
}

interface SeekLyricsProps {
  readonly target: SeekPreview | null;
}

export function SeekLyrics({ target }: SeekLyricsProps) {
  const content = useLyricsPreview(target);
  return (
    <div className={styles.inline} data-visible={content.visible || undefined}>
      <PreviewText content={content} />
      <span className={styles.description} id={target?.descriptionId}>
        {content.cue?.text} {content.cue?.sub}
      </span>
    </div>
  );
}

const useStyles = makeStyles({
  content: {
    boxSizing: 'border-box',
    maxWidth: `calc(100vw - 2 * ${tokens.spacingHorizontalM})`,
    padding: tokens.spacingHorizontalM,
    borderRadius: roleVar('radius-overlay'),
    ...shorthands.border(tokens.strokeWidthThin, 'solid', tokens.colorNeutralStrokeAlpha),
    boxShadow: tokens.shadow8,
    pointerEvents: 'none',
    animationDuration: durationVar('faster'),
    animationTimingFunction: CURVE.linear.css,
  },
});

export function SeekLyricsPopover({ target }: SeekLyricsProps) {
  const content = useLyricsPreview(target);
  const classes = useStyles();
  return (
    <>
      <Tooltip
        relationship="inaccessible"
        visible={content.visible}
        positioning={{
          position: 'above',
          target: content.anchor,
          offset: 8,
          overflowBoundaryPadding: 12,
        }}
        content={{
          className: classes.content,
          children: (
            <div
              className={styles.popover}
              data-synced={content.synced || undefined}
              data-sub={content.hasSub || undefined}
            >
              <div className={styles.time}>{clockText(content.seconds)}</div>
              <PreviewText content={content} />
            </div>
          ),
        }}
      >
        <span className={styles.anchor} aria-hidden />
      </Tooltip>
      <span className={styles.description} id={target?.descriptionId}>
        {content.cue?.text} {content.cue?.sub}
      </span>
    </>
  );
}
