import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { Button, Spinner, Switch, Tab, Tooltip } from '@fluentui/react-components';
import {
  AlbumRegular,
  MicRegular,
  ArrowClockwise16Regular,
  Globe20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MessageKey } from '../../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { LyricsPlayer } from '../../../lyrics/LyricsPlayer.tsx';
import type { LyricsClockFace } from '../../../lyrics/lyricsDriver.ts';
import { lyricsKey, type LyricsState } from '../../../lyrics/lyricsService.ts';
import { lyricsPrefsKey } from '../../../lyrics/lyricsPrefs.ts';
import { lyricsMotionKey } from '../../../lyrics/lyricsMotion.ts';
import { lyricsDisplayKey } from '../../../lyrics/lyricsDisplay.ts';
import { lyricsCandidateId } from '../../../lyrics/lyricsSearchSession.ts';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { CURVE, DURATION_MS, motionDuration } from '../../../motion/timing.ts';
import { TabList } from '../../../motion/Surfaces.tsx';
import { createSnapshotSlot } from '../../../nav/historyStack.ts';
import { useRightCard, useRightCardSnapshot } from '../rightCardContext.ts';
import { LyricsSearch } from './LyricsSearch.tsx';
import { LyricsDetailPage } from './LyricsDetailPage.tsx';
import { LyricsReading } from './LyricsReading.tsx';
import { LyricsTools } from './LyricsTools.tsx';
import { LyricsPreviewContext } from './useLyricsPreview.ts';
import styles from './LyricsPage.module.css';

interface LyricsPageProps {
  readonly title: string;
  readonly trackKey: string;
  readonly artist: string;
  readonly album: string;
  readonly clock: LyricsClockFace;
  readonly active: boolean;
  readonly connected: boolean;
  readonly trackStatus: 'pending' | 'ready' | 'failed';
  readonly canSeek: boolean;
  readonly saveNotice: ReactNode;
  readonly saveFailed: boolean;
  onOpenSettings(): void;
  onSeek(key: string, seconds: number): void;
  onRetryPlayback(): void;
}
const SNAPSHOT = createSnapshotSlot<{ view: 'synced' | 'text' }>();

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
  const { title, artist, album, active, connected, trackStatus, canSeek, clock, onSeek } = props;
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const locale = useAtomValueRawSync(localeAtom).active;
  const service = useService(lyricsKey);
  const prefs = useService(lyricsPrefsKey);
  const motion = useService(lyricsMotionKey);
  const displayService = useService(lyricsDisplayKey);
  const state = useAtomValueRawSync(service.state);
  const subject = useAtomValueRawSync(service.subject);
  const offset = useAtomValueRawSync(service.offset);
  const online = useAtomValueRawSync(prefs.pref).enabled;
  const effects = useAtomValueRawSync(motion.motion);
  const display = useAtomValueRawSync(displayService.display);
  const { card } = useRightCard();
  const { place, entry } = useAtomValueRawSync(card.navigation);
  const searching = place.id === 'lyricsSearch';
  const subpage = place.id !== 'lyrics';
  const preview = useContext(LyricsPreviewContext);
  const controlsVisible = preview?.visible ?? true;
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<'synced' | 'text'>('synced');
  const previousView = useRef(view);
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const privacyId = useId();
  const onlineInput = useRef<HTMLInputElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const ready = state.status === 'ready' ? state : null;
  const pin = preview?.pin;
  useRightCardSnapshot(
    SNAPSHOT,
    { capture: () => ({ view }), restore: (snapshot) => setView(snapshot.view) },
    !subpage,
  );
  useLayoutEffect(() => {
    pin?.(subpage || !ready || props.saveFailed || menuOpen);
    return () => pin?.(false);
  }, [pin, subpage, ready, props.saveFailed, menuOpen]);
  useLayoutEffect(() => {
    const parent = root.current;
    const top = head.current;
    const bottom = footer.current;
    if (!parent || !top || !bottom) return;
    const measure = () => {
      parent.style.setProperty('--lyrics-head-height', `${top.getBoundingClientRect().height}px`);
      parent.style.setProperty(
        '--lyrics-footer-height',
        `${bottom.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [subpage]);
  useLayoutEffect(() => {
    const animations = [
      body.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: motionDuration(DURATION_MS.faster, reduced),
        easing: CURVE.linear.timing,
      }),
    ];
    return () => animations.forEach((animation) => animation?.cancel());
  }, [ready?.content, reduced]);
  useLayoutEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    const animation = body.current?.animate(
      [{ transform: 'translateY(20px)' }, { transform: 'none' }],
      { duration: motionDuration(DURATION_MS.normal, reduced), easing: CURVE.decelerateMid.timing },
    );
    return () => animation?.cancel();
  }, [view, reduced]);
  const loading = connected && (state.status === 'loading' || trackStatus === 'pending');
  const retry = !connected || trackStatus === 'failed' ? props.onRetryPlayback : service.refresh;
  const message = !connected
    ? 'host.unavailable'
    : trackStatus === 'failed'
      ? 'lyrics.trackFailed'
      : trackStatus === 'pending'
        ? 'lyrics.loading'
        : statusKey(state);
  const navigate = (id: 'lyricsSearch' | 'lyricsDetails' | 'lyricsTiming') =>
    card.history.navigate({ id, subject });
  const onlineControl = (
    <>
      <Switch
        input={{ ref: onlineInput }}
        label={t('lyrics.online')}
        checked={online}
        disabled={!connected}
        aria-describedby={!online ? privacyId : undefined}
        onChange={(_, data) => void prefs.setEnabled(data.checked, locale)}
      />
      {!online && (
        <p id={privacyId} className={styles.privacy}>
          {t('lyrics.privacy')}
        </p>
      )}
    </>
  );
  if (subpage)
    return (
      <section ref={root} className={styles.subpage} data-lyrics-panel>
        <div className={styles.body} key={entry.key}>
          {searching ? (
            <LyricsSearch
              title={title}
              artist={artist}
              enabled={active && online && connected}
              onlineControl={onlineControl}
              onUsed={() => card.history.navigate({ id: 'lyrics' })}
              onPreview={(candidate) =>
                card.history.navigate({
                  id: 'lyricsCandidate',
                  subject,
                  candidate: lyricsCandidateId(candidate),
                })
              }
            />
          ) : (
            <LyricsDetailPage clock={clock} active={active} canSeek={canSeek} onSeek={onSeek} />
          )}
        </div>
        {props.saveNotice}
      </section>
    );
  return (
    <section
      ref={root}
      className={styles.root}
      aria-label={t('lyrics.region')}
      data-lyrics-panel
      data-lyrics-ready={!!ready || undefined}
      data-controls-visible={controlsVisible || undefined}
    >
      <div
        ref={head}
        className={styles.head}
        data-lyrics-preview-controls
        inert={!controlsVisible}
        aria-hidden={!controlsVisible || undefined}
      >
        <div className={styles.identity}>
          <div className={styles.track}>
            <strong>{title || t('lyrics.untitled')}</strong>
            <div className={styles.byline}>
              {artist && (
                <span>
                  <MicRegular aria-label={t('trackInfo.artist')} />
                  {artist}
                </span>
              )}
              {album && (
                <span>
                  <AlbumRegular aria-label={t('trackInfo.album')} />
                  {album}
                </span>
              )}
            </div>
          </div>
          <Tooltip content={t('lyrics.refresh')} relationship="label">
            <Button
              ref={refreshButton}
              className={controls.icon}
              appearance="subtle"
              icon={<ArrowClockwise16Regular />}
              disabled={loading || (!title && connected && trackStatus !== 'failed')}
              disabledFocusable={loading}
              onClick={retry}
            />
          </Tooltip>
        </div>
        <div className={styles.views}>
          {ready?.content.kind === 'synced' && (
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
          <div className={styles.tools}>
            <LyricsTools
              ready={!!ready}
              timed={ready?.content.kind === 'synced'}
              disabled={!connected || !props.trackKey}
              onSearch={() => navigate('lyricsSearch')}
              onDetails={() => navigate('lyricsDetails')}
              onTiming={() => navigate('lyricsTiming')}
              onSettings={props.onOpenSettings}
              onAutomatic={() => void service.restoreAutomatic()}
              onOpenChange={setMenuOpen}
            />
          </div>
        </div>
      </div>
      <div ref={body} className={styles.body} data-lyrics-status={state.status}>
        {ready ? (
          ready.content.kind === 'synced' && view === 'synced' ? (
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
                  offset={offset}
                  onSeek={canSeek ? (seconds) => onSeek(ready.key, seconds) : undefined}
                />
              </div>
              <div className={styles['screen-reader-text']}>
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
          ) : (
            <div className={styles.reading}>
              <LyricsReading
                content={ready.content}
                interactive={ready.content.kind === 'synced'}
                offset={offset}
                onSeek={canSeek ? (seconds) => onSeek(ready.key, seconds) : undefined}
              />
            </div>
          )
        ) : (
          <div className={styles.empty}>
            {loading ? (
              <Spinner size="small" label={t(message)} />
            ) : (
              <p role="status">{t(message)}</p>
            )}
            {!loading && (state.status === 'failed' || !connected || trackStatus === 'failed') && (
              <Button
                className={controls.field}
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
              <Button
                appearance="primary"
                icon={<Globe20Regular />}
                onClick={() => {
                  onlineInput.current?.focus();
                  void prefs.setEnabled(true, locale);
                }}
                aria-describedby={privacyId}
              >
                {t('lyrics.searchOnline')}
              </Button>
            )}
          </div>
        )}
      </div>
      <div
        ref={footer}
        className={styles.footer}
        data-lyrics-controls
        data-lyrics-preview-controls
        data-visible={controlsVisible || undefined}
        inert={!controlsVisible}
        aria-hidden={!controlsVisible || undefined}
      >
        {ready && (
          <span className={styles.source} data-lyrics-source={ready.source}>
            {t(`lyrics.source.${ready.source}`)}
          </span>
        )}
        {onlineControl}
        {props.saveNotice}
      </div>
    </section>
  );
}
