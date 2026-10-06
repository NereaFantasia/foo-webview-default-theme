import {
  Button,
  Spinner,
  Switch,
  Tab,
  TabList,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowClockwise16Regular,
  Globe20Regular,
  MusicNote2Play20Regular,
  Search16Regular,
  Settings16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MessageKey } from '../../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { LyricsPlayer } from '../../../lyrics/LyricsPlayer.tsx';
import { LyricsPlainText } from '../../../lyrics/LyricsPlainText.tsx';
import type { LyricsClockFace } from '../../../lyrics/lyricsDriver.ts';
import { lyricsKey, type LyricsState } from '../../../lyrics/lyricsService.ts';
import { lyricsPrefsKey } from '../../../lyrics/lyricsPrefs.ts';
import { lyricsMotionKey } from '../../../lyrics/lyricsMotion.ts';
import { lyricsDisplayKey } from '../../../lyrics/lyricsDisplay.ts';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { stepEnter } from '../../../motion/stepTransition.ts';
import { usePointerActivity } from '../../../kit/usePointerActivity.ts';
import { clockText } from '../../../playback/seekDraft.ts';
import { LyricsSearch } from './LyricsSearch.tsx';
import styles from './LyricsPage.module.css';

interface LyricsPageProps {
  readonly title: string;
  readonly trackKey: string;
  readonly artist: string;
  readonly cover: string | null;
  readonly clock: LyricsClockFace;
  readonly active: boolean;
  readonly connected: boolean;
  readonly trackStatus: 'pending' | 'ready' | 'failed';
  readonly canSeek: boolean;
  readonly saveNotice: ReactNode;
  onOpenSettings(): void;
  onSeek(key: string, seconds: number): void;
  onRetryPlayback(): void;
}

const useStyles = makeStyles({
  line: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    padding: tokens.spacingVerticalS,
  },
});

function statusKey(state: LyricsState): MessageKey {
  switch (state.status) {
    case 'idle':
      return 'lyrics.idle';
    case 'waiting':
      return 'lyrics.searching';
    case 'loading':
      return state.stage === 'local' ? 'lyrics.loading' : 'lyrics.searching';
    case 'failed':
      return state.stage === 'local' ? 'lyrics.localFailed' : 'lyrics.onlineFailed';
    case 'missing':
      return state.reason === 'metadata'
        ? 'lyrics.metadataMissing'
        : state.reason === 'local'
          ? 'lyrics.localMissing'
          : 'lyrics.onlineMissing';
    case 'ready':
      return 'lyrics.region';
  }
}

export function LyricsPage(props: LyricsPageProps) {
  const { title, artist, cover, active, connected, trackStatus, canSeek, clock, onSeek } = props;
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const service = useService(lyricsKey);
  const prefs = useService(lyricsPrefsKey);
  const motion = useService(lyricsMotionKey);
  const state = useAtomValueRawSync(service.state);
  const online = useAtomValueRawSync(prefs.pref).enabled;
  const effects = useAtomValueRawSync(motion.motion);
  const displayService = useService(lyricsDisplayKey);
  const display = useAtomValueRawSync(displayService.display);
  const saveStates = useAtomValueRawSync(prefs.persistence.state);
  const saveFailed = [...saveStates.values()].some((value) => value.status === 'failed');
  const activity = usePointerActivity();
  const [searching, setSearching] = useState(false);
  const root = useRef<HTMLElement>(null);
  const previousSearch = useRef(false);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [view, setView] = useState<'synced' | 'text'>('synced');
  const privacyId = useId();
  const timelineId = useId();
  const onlineInput = useRef<HTMLInputElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (previousSearch.current === searching) return;
    previousSearch.current = searching;
    if (!searching) searchButton.current?.focus();
    const animations = stepEnter(searching ? 'forward' : 'back', reduced).flatMap((leg) => {
      const animation = root.current?.animate(leg.keyframes, leg.options);
      return animation ? [animation] : [];
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [searching, reduced]);
  const classes = useStyles();
  const ready = state.status === 'ready' ? state : null;
  const loading = connected && (state.status === 'loading' || trackStatus === 'pending');
  const retry = !connected || trackStatus === 'failed' ? props.onRetryPlayback : service.refresh;
  const message = !connected
    ? 'host.unavailable'
    : trackStatus === 'failed'
      ? 'lyrics.trackFailed'
      : trackStatus === 'pending'
        ? 'lyrics.loading'
        : statusKey(state);
  const enable = () => {
    onlineInput.current?.focus();
    void prefs.setEnabled(true, locale);
  };
  return (
    <section
      ref={root}
      className={styles.root}
      aria-label={t('lyrics.region')}
      data-lyrics-panel
      data-searching={searching || undefined}
      onPointerMove={activity.touch}
      onPointerEnter={activity.touch}
      onPointerDown={activity.touch}
      onFocusCapture={activity.touch}
    >
      <div className={styles.head} hidden={searching}>
        <div className={styles.identity}>
          <div className={styles.cover}>
            {cover ? <img src={cover} alt="" /> : <MusicNote2Play20Regular />}
          </div>
          <div className={styles.track}>
            <strong>{title || t('lyrics.untitled')}</strong>
            <span>{artist}</span>
          </div>
          <Tooltip content={t('lyrics.refresh')} relationship="label">
            <Button
              ref={refreshButton}
              appearance="subtle"
              icon={<ArrowClockwise16Regular />}
              disabled={loading || (!title && connected && trackStatus !== 'failed')}
              disabledFocusable={loading}
              onClick={retry}
            />
          </Tooltip>
          <Tooltip content={t('lyrics.settings')} relationship="label">
            <Button
              appearance="subtle"
              icon={<Settings16Regular />}
              onClick={props.onOpenSettings}
            />
          </Tooltip>
        </div>
        {ready && (
          <div className={styles.views}>
            <span className={styles.source} data-lyrics-source={ready.source}>
              {t(`lyrics.source.${ready.source}`)}
            </span>
            {ready.content.kind === 'synced' && (
              <TabList
                size="small"
                aria-label={t('lyrics.view')}
                selectedValue={view}
                onTabSelect={(_, data) => setView(data.value === 'text' ? 'text' : 'synced')}
              >
                <Tab value="synced">{t('lyrics.synced')}</Tab>
                <Tab value="text">{t('lyrics.transcript')}</Tab>
              </TabList>
            )}
          </div>
        )}
      </div>
      <div className={styles.body} data-lyrics-status={state.status}>
        {searching ? (
          <LyricsSearch
            key={`${props.trackKey}:${title}:${artist}`}
            title={title}
            artist={artist}
            enabled={active && online && connected}
            onlineControl={
              <>
                <Switch
                  label={t('lyrics.online')}
                  checked={online}
                  disabled={!connected}
                  onChange={(_, data) => void prefs.setEnabled(data.checked, locale)}
                />
                <p className={styles.privacy}>
                  {t(connected ? 'lyrics.privacy' : 'host.unavailable')}
                </p>
              </>
            }
            onClose={() => setSearching(false)}
          />
        ) : ready ? (
          ready.content.kind === 'plain' ? (
            <LyricsPlainText
              key={ready.key}
              lines={ready.content.lines}
              fontSize={display.fontSize}
            />
          ) : view === 'synced' ? (
            <>
              <div className={styles.animation} aria-hidden>
                <LyricsPlayer
                  key={ready.key}
                  lines={ready.content.lines}
                  motion={effects}
                  clock={clock}
                  active={active}
                  fontSize={display.fontSize}
                  display={display}
                  onSeek={canSeek ? (seconds) => onSeek(ready.key, seconds) : undefined}
                />
              </div>
              <div className={styles['screen-reader-text']}>
                {ready.content.lines.map((line, index) => (
                  <p key={index}>
                    {line.words.map((word) => word.word).join('')}
                    {line.translatedLyric && <span> {line.translatedLyric}</span>}
                    {line.romanLyric && <span> {line.romanLyric}</span>}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <ol className={styles.transcript} key={ready.key} data-lyrics-transcript>
              {ready.content.lines
                .filter((line) => line.words.some((word) => word.word.trim()))
                .map((line, index) => (
                  <li key={index}>
                    <div className={styles.timestamp}>
                      <time id={`${timelineId}-${index}`} dateTime={`PT${line.startTime / 1000}S`}>
                        {clockText(line.startTime / 1000)}
                      </time>
                    </div>
                    <Button
                      className={classes.line}
                      appearance="subtle"
                      disabled={!canSeek}
                      aria-describedby={`${timelineId}-${index}`}
                      onClick={() => onSeek(ready.key, line.startTime / 1000)}
                    >
                      <span className={styles['line-text']}>
                        {line.words.map((word) => word.word).join('')}
                      </span>
                      {line.translatedLyric && (
                        <span className={styles.translation}>{line.translatedLyric}</span>
                      )}
                      {line.romanLyric && (
                        <span className={styles.translation}>{line.romanLyric}</span>
                      )}
                    </Button>
                  </li>
                ))}
            </ol>
          )
        ) : (
          <div className={styles.empty}>
            {loading && connected ? (
              <Spinner size="small" label={t(message)} />
            ) : (
              <p role="status">{t(message)}</p>
            )}
            {!loading && (state.status === 'failed' || !connected || trackStatus === 'failed') && (
              <Button
                icon={<ArrowClockwise16Regular />}
                onClick={() => {
                  refreshButton.current?.focus();
                  retry();
                }}
              >
                {t('lyrics.retry')}
              </Button>
            )}
            {!online && connected && (state.status === 'missing' || state.status === 'failed') && (
              <Button icon={<Globe20Regular />} onClick={enable} aria-describedby={privacyId}>
                {t('lyrics.searchOnline')}
              </Button>
            )}
          </div>
        )}
      </div>
      <div
        className={styles.footer}
        hidden={searching}
        data-lyrics-controls
        data-visible={activity.active || saveFailed || undefined}
      >
        <div className={styles.controls}>
          <Switch
            input={{ ref: onlineInput }}
            label={t('lyrics.online')}
            checked={online}
            disabled={!connected}
            aria-describedby={!online ? privacyId : undefined}
            onChange={(_, data) => void prefs.setEnabled(data.checked, locale)}
          />
          <Tooltip content={t('lyrics.search')} relationship="label">
            <Button
              ref={searchButton}
              appearance="subtle"
              icon={<Search16Regular />}
              disabled={!connected || !props.trackKey}
              onClick={() => setSearching(true)}
            />
          </Tooltip>
        </div>
        {!online && (
          <p id={privacyId} className={styles.privacy}>
            {t('lyrics.privacy')}
          </p>
        )}
        {props.saveNotice}
      </div>
    </section>
  );
}
