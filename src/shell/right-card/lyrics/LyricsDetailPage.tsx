import { lyricsPrefsKey } from '../../../lyrics/lyricsPrefs.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { Button, Checkbox, SpinButton, Spinner, Switch } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { lyricsKey } from '../../../lyrics/lyricsService.ts';
import { lyricsDisplayKey } from '../../../lyrics/lyricsDisplay.ts';
import { lyricsMotionKey } from '../../../lyrics/lyricsMotion.ts';
import { LyricsPlayer } from '../../../lyrics/LyricsPlayer.tsx';
import type { LyricsClockFace } from '../../../lyrics/lyricsDriver.ts';
import { isWordLevel } from '../../../lyrics/lyricsText.ts';
import { useRightCard } from '../rightCardContext.ts';
import { LyricsReading } from './LyricsReading.tsx';
import { LyricsSubpageHeading } from './LyricsSubpageHeading.tsx';
import styles from './LyricsDetailPage.module.css';

export function LyricsDetailPage({
  clock,
  active,
  canSeek,
  onSeek,
}: {
  readonly clock: LyricsClockFace;
  readonly active: boolean;
  readonly canSeek: boolean;
  onSeek(key: string, seconds: number): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const prefs = useService(lyricsPrefsKey);
  const online = useAtomValueRawSync(prefs.pref).enabled;
  const locale = useAtomValueRawSync(localeAtom).active;
  const { card } = useRightCard();
  const { place } = useAtomValueRawSync(card.navigation);
  const service = useService(lyricsKey);
  const state = useAtomValueRawSync(service.state);
  const preview = useAtomValueRawSync(service.preview);
  const offset = useAtomValueRawSync(service.offset);
  const displayService = useService(lyricsDisplayKey);
  const display = useAtomValueRawSync(displayService.display);
  const motionService = useService(lyricsMotionKey);
  const motion = useAtomValueRawSync(motionService.motion);
  const [remember, setRemember] = useState(false);
  const [using, setUsing] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const candidate = place.candidate ? service.candidate(place.candidate) : undefined;
  useEffect(() => {
    if (candidate && active) void service.previewCandidate(candidate, place.subject);
  }, [service, candidate, place.subject, active, online]);
  const ready = state.status === 'ready' ? state : null;
  const heading = (
    <header>
      <LyricsSubpageHeading
        title={t(
          place.id === 'lyricsCandidate'
            ? 'lyrics.preview'
            : place.id === 'lyricsTiming'
              ? 'lyrics.timing'
              : 'lyrics.details',
        )}
      />
      {place.id === 'lyricsCandidate' && <span>{candidate?.title}</span>}
    </header>
  );
  if (place.id === 'lyricsCandidate') {
    const found = preview.status === 'ready' && preview.id === place.candidate ? preview : null;
    return (
      <section className={styles.root} data-lyrics-candidate-preview>
        {heading}
        <div className={styles.body}>
          {found ? (
            <LyricsReading content={found.content} />
          ) : !online ? (
            <div className={styles.empty}>
              <p role="status">{t('lyrics.onlineOff')}</p>
              <Switch
                label={t('lyrics.online')}
                checked={false}
                onChange={(_, data) => void prefs.setEnabled(data.checked, locale)}
              />
            </div>
          ) : preview.status === 'failed' || preview.status === 'missing' ? (
            <div className={styles.empty}>
              <p role="status">
                {t(preview.status === 'missing' ? 'lyrics.selectedMissing' : 'lyrics.fetchFailed')}
              </p>
              <Button
                className={controls.field}
                onClick={() => {
                  if (candidate) void service.previewCandidate(candidate, place.subject);
                }}
              >
                {t('lyrics.retry')}
              </Button>
            </div>
          ) : (
            <Spinner size="small" label={t('lyrics.loading')} />
          )}
        </div>
        <footer>
          <Checkbox
            label={t('lyrics.remember')}
            checked={remember}
            onChange={(_, data) => setRemember(data.checked === true)}
          />
          <Button
            appearance="primary"
            disabled={!found || using}
            onClick={() => {
              if (!candidate) return;
              setUsing(true);
              void service.choose(candidate, remember, place.subject).then((used) => {
                if (!alive.current) return;
                setUsing(false);
                if (used) card.history.navigate({ id: 'lyrics' });
              });
            }}
          >
            {t('lyrics.useLyrics')}
          </Button>
        </footer>
      </section>
    );
  }
  if (!ready)
    return (
      <section className={styles.root}>
        {heading}
        <div className={styles.empty}>
          <p role="status">{t('lyrics.loading')}</p>
        </div>
      </section>
    );
  if (place.id === 'lyricsTiming')
    return (
      <section className={styles.root} data-lyrics-timing>
        {heading}
        <div className={styles.body}>
          {ready.content.kind === 'synced' && (
            <LyricsPlayer
              lines={ready.content.lines}
              clock={clock}
              active={active}
              motion={motion}
              display={display}
              fontSize={display.fontSize}
              offset={offset}
              onSeek={canSeek ? (seconds) => onSeek(ready.key, seconds) : undefined}
            />
          )}
        </div>
        <footer>
          <label className={styles.offset}>
            <span>{t('lyrics.offset')}</span>
            <SpinButton
              className={controls.field}
              aria-label={t('lyrics.offset')}
              value={offset}
              min={-600}
              max={600}
              step={0.1}
              precision={2}
              onChange={(_, data) => {
                const value = data.value ?? Number(data.displayValue);
                if (Number.isFinite(value)) void service.setOffset(value);
              }}
            />
          </label>
          <div className={styles.actions}>
            <Button className={controls.field} onClick={() => void service.setOffset(offset - 0.1)}>
              {t('lyrics.earlier')}
            </Button>
            <Button className={controls.field} onClick={() => void service.setOffset(offset + 0.1)}>
              {t('lyrics.later')}
            </Button>
          </div>
          <div className={styles.actions}>
            <Button
              appearance="subtle"
              className={controls.field}
              onClick={() => void service.setOffset(0)}
              disabled={offset === 0}
            >
              {t('lyrics.resetTime')}
            </Button>
            <Button
              className={controls.field}
              disabled={!canSeek}
              onClick={() => {
                if (ready.content.kind !== 'synced') return;
                const lines = ready.content.lines.filter(
                  (line) => !line.isBG && line.words.some((word) => word.word.trim()),
                );
                const current =
                  [...lines]
                    .reverse()
                    .find((line) => line.startTime / 1000 <= clock.position() - offset) ?? lines[0];
                if (current) onSeek(ready.key, current.startTime / 1000);
              }}
            >
              {t('lyrics.replayLine')}
            </Button>
          </div>
        </footer>
      </section>
    );
  const kind = isWordLevel(ready.content)
    ? 'word'
    : ready.content.kind === 'synced'
      ? 'line'
      : 'plain';
  return (
    <section className={styles.root} data-lyrics-details>
      {heading}
      <div className={styles.details}>
        <dl>
          <dt>{t('lyrics.sourceLabel')}</dt>
          <dd>{t(`lyrics.source.${ready.source}`)}</dd>
          <dt>{t('lyrics.format')}</dt>
          <dd>{t(`lyrics.${kind}`)}</dd>
          <dt>{t('lyrics.lineCount')}</dt>
          <dd>{ready.content.lines.length}</dd>
          {ready.sourcePath && (
            <>
              <dt>{t('lyrics.filePath')}</dt>
              <dd>{ready.sourcePath}</dd>
            </>
          )}
          {ready.content.kind === 'synced' && (
            <>
              <dt>{t('lyrics.offset')}</dt>
              <dd>{offset.toFixed(2)}</dd>
            </>
          )}
        </dl>
        {ready.content.kind === 'synced' && (
          <Button
            className={controls.field}
            onClick={() => card.history.navigate({ id: 'lyricsTiming', subject: place.subject })}
          >
            {t('lyrics.timing')}
          </Button>
        )}
      </div>
    </section>
  );
}
