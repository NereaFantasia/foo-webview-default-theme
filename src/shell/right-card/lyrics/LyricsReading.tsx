import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useRef, type CSSProperties } from 'react';
import { useService } from '../../../kit/useService.ts';
import {
  DEFAULT_LYRICS_DISPLAY,
  lyricsDisplayKey,
  lyricsFontFamily,
} from '../../../lyrics/lyricsDisplay.ts';
import type { LyricsContent } from '../../../lyrics/lyricsText.ts';
import { clockText } from '../../../playback/seekDraft.ts';
import { createSnapshotSlot } from '../../../nav/historyStack.ts';
import { useRightCardSnapshot } from '../rightCardContext.ts';
import styles from './LyricsReading.module.css';

const SNAPSHOT = createSnapshotSlot<{ scroll: number; focused: number }>();
const PREVIEW_SCALE = 0.8;
const useStyles = makeStyles({
  line: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    whiteSpace: 'normal',
    font: 'inherit',
    padding: `calc(${tokens.spacingVerticalS} * var(--lyrics-preview-spacing-scale)) ${tokens.spacingHorizontalS}`,
  },
});

export function LyricsReading({
  content,
  offset = 0,
  onSeek,
  interactive = !!onSeek,
}: {
  readonly content: LyricsContent;
  readonly offset?: number;
  readonly interactive?: boolean;
  readonly onSeek?: (seconds: number) => void;
}) {
  const service = useService(lyricsDisplayKey);
  const display = useAtomValueRawSync(service.display);
  const root = useRef<HTMLDivElement>(null);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const timeId = useId();
  const style: CSSProperties & Record<`--${string}`, string | number> = {
    fontFamily: lyricsFontFamily(display.fontFamily),
    '--lyrics-preview-font-size': `${display.fontSize * PREVIEW_SCALE}px`,
    '--lyrics-preview-spacing-scale': display.fontSize / DEFAULT_LYRICS_DISPLAY.fontSize,
    ...(display.translationFontSize === null
      ? {}
      : {
          '--lyrics-preview-translation-size': `${display.translationFontSize * PREVIEW_SCALE}px`,
        }),
  };
  useRightCardSnapshot(SNAPSHOT, {
    capture: () => ({
      scroll: root.current?.scrollTop ?? 0,
      focused: [...(root.current?.querySelectorAll('button') ?? [])].findIndex(
        (element) => element === document.activeElement,
      ),
    }),
    restore: (value) => {
      if (root.current) {
        root.current.scrollTop = value.scroll;
        root.current.querySelectorAll('button')[value.focused]?.focus({ preventScroll: true });
      }
    },
  });
  return (
    <div ref={root} className={styles.root} data-lyrics-transcript style={style}>
      {content.kind === 'plain'
        ? content.lines.map((line, index) => <p key={index}>{line}</p>)
        : content.lines
            .filter((line) => line.words.some((word) => word.word.trim()))
            .map((line, index) => {
              const body = (
                <>
                  <span>{line.words.map((word) => word.word).join('')}</span>
                  {display.showTranslation && line.translatedLyric && (
                    <span className={`${styles.sub} ${styles.translation}`}>
                      {line.translatedLyric}
                    </span>
                  )}
                  {display.showRomanization && line.romanLyric && (
                    <span className={styles.sub}>{line.romanLyric}</span>
                  )}
                </>
              );
              return (
                <div key={index} className={styles.row}>
                  <time id={`${timeId}-${index}`} className={styles.time}>
                    {clockText(Math.max(0, line.startTime / 1000 + offset))}
                  </time>
                  {interactive ? (
                    <Button
                      appearance="subtle"
                      className={mergeClasses(classes.line, controls.icon)}
                      aria-describedby={`${timeId}-${index}`}
                      disabled={!onSeek}
                      onClick={() => onSeek?.(line.startTime / 1000)}
                    >
                      {body}
                    </Button>
                  ) : (
                    <div className={styles.line}>{body}</div>
                  )}
                </div>
              );
            })}
    </div>
  );
}
