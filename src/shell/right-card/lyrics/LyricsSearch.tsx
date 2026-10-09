import { ReadingSurface } from '../../../theme/ReadingSurface.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { Button, Input, Spinner, Tooltip } from '@fluentui/react-components';
import {
  AlbumRegular,
  MicRegular,
  ChevronRight16Regular,
  Dismiss16Regular,
  Globe16Regular,
  Info16Regular,
  Search16Regular,
  SoundWaveCircle16Regular,
  Translate16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { lyricsKey } from '../../../lyrics/lyricsService.ts';
import { lyricsCandidateId } from '../../../lyrics/lyricsSearchSession.ts';
import type { LyricsCandidate } from '../../../lyrics/online/lyricsSource.ts';
import { isWordLevel } from '../../../lyrics/lyricsText.ts';
import { createSnapshotSlot } from '../../../nav/historyStack.ts';
import { useRightCardSnapshot } from '../rightCardContext.ts';
import { LyricsSubpageHeading } from './LyricsSubpageHeading.tsx';
import { LyricsCandidateCover } from './LyricsCandidateCover.tsx';
import styles from './LyricsSearch.module.css';

const SNAPSHOT = createSnapshotSlot<{ keywords: string; scroll: number; focus: string }>();

export function LyricsSearch({
  title,
  artist,
  enabled,
  onlineControl,
  onUsed,
  onPreview,
}: {
  readonly title: string;
  readonly artist: string;
  readonly enabled: boolean;
  readonly onlineControl: ReactNode;
  onUsed(): void;
  onPreview(candidate: LyricsCandidate): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const listFormat = new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' });
  const controls = useViewControlStyles();
  const service = useService(lyricsKey);
  const result = useAtomValueRawSync(service.choices);
  const subject = useAtomValueRawSync(service.subject);
  const [keywords, setKeywords] = useState(
    result.keywords || [title, artist].filter(Boolean).join(' '),
  );
  const [composing, setComposing] = useState(false);
  const [using, setUsing] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const pendingSnapshot = useRef<{ keywords: string; scroll: number; focus: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useRightCardSnapshot(SNAPSHOT, {
    capture: () => ({
      keywords,
      scroll: results.current?.scrollTop ?? 0,
      focus:
        document.activeElement instanceof HTMLElement
          ? (document.activeElement.dataset.lyricsFocus ?? '')
          : '',
    }),
    restore: (value) => {
      pendingSnapshot.current = value;
      setKeywords(value.keywords);
      void service.search(value.keywords);
    },
  });
  useLayoutEffect(() => {
    const pending = pendingSnapshot.current;
    if (
      !pending ||
      result.keywords.trim() !== pending.keywords.trim() ||
      keywords !== pending.keywords ||
      (pending.keywords.trim() && result.status !== 'ready')
    )
      return;
    if (results.current) results.current.scrollTop = pending.scroll;
    const focused = [
      ...(root.current?.querySelectorAll<HTMLElement>('[data-lyrics-focus]') ?? []),
    ].find((element) => element.dataset.lyricsFocus === pending.focus);
    focused?.focus({ preventScroll: true });
    pendingSnapshot.current = null;
  }, [result, keywords]);
  useEffect(() => {
    if (
      enabled &&
      !composing &&
      keywords.trim() &&
      (keywords.trim() !== result.keywords.trim() || result.status === 'idle')
    )
      timer.current = setTimeout(() => void service.search(keywords), 400);
    return () => clearTimeout(timer.current);
  }, [service, enabled, composing, keywords, result.keywords, result.status]);
  return (
    <section ref={root} className={styles.root} aria-label={t('lyrics.search')} data-lyrics-search>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (enabled && !composing) {
            clearTimeout(timer.current);
            void service.search(keywords, true);
          }
        }}
      >
        <LyricsSubpageHeading title={t('lyrics.search')} />
        <Input
          className={controls.field}
          ref={input}
          autoFocus
          data-lyrics-focus="query"
          aria-label={t('lyrics.keywords')}
          placeholder={t('lyrics.keywords')}
          value={keywords}
          onChange={(_, data) => {
            service.cancelSearch();
            setKeywords(data.value);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          contentBefore={<Search16Regular />}
          contentAfter={
            keywords && (
              <Button
                appearance="subtle"
                size="small"
                className={controls.icon}
                icon={<Dismiss16Regular />}
                aria-label={t('lyrics.clearSearch')}
                onClick={() => {
                  input.current?.focus();
                  service.cancelSearch();
                  setKeywords('');
                }}
              />
            )
          }
        />
        {!enabled && <div onChangeCapture={() => input.current?.focus()}>{onlineControl}</div>}
      </form>
      <div ref={results} className={styles.results}>
        {result.status === 'searching' && <Spinner size="small" label={t('lyrics.searching')} />}
        {(result.status === 'search-failed' || result.failed.length > 0) && (
          <p role="status">
            {result.failed.length
              ? t('lyrics.failedSources', {
                  sources: listFormat.format(
                    result.failed.map((source) => t(`lyrics.source.${source}`)),
                  ),
                })
              : t('lyrics.searchFailed')}
          </p>
        )}
        {result.status === 'fetch-failed' && <p role="status">{t('lyrics.fetchFailed')}</p>}
        {result.status === 'missing' && <p role="status">{t('lyrics.selectedMissing')}</p>}
        {result.status === 'ready' && !result.failed.length && !result.candidates.length && (
          <p role="status">{t('lyrics.onlineMissing')}</p>
        )}
        {result.candidates.map((candidate) => {
          const id = lyricsCandidateId(candidate);
          const kind = !candidate.content
            ? candidate.contentStatus === 'loading'
              ? 'loading'
              : candidate.contentStatus === 'missing'
                ? 'candidateMissing'
                : candidate.contentStatus === 'failed'
                  ? 'candidateFailed'
                  : 'unknownFormat'
            : isWordLevel(candidate.content)
              ? 'word'
              : candidate.content.kind === 'synced'
                ? 'line'
                : 'plain';
          const translated =
            candidate.content?.kind === 'synced' &&
            candidate.content.lines.some((line) => line.translatedLyric.trim());
          return (
            <article key={id} className={styles.candidate} data-lyrics-candidate>
              <ReadingSurface />
              <LyricsCandidateCover
                candidate={candidate}
                enabled={enabled}
                viewport={results}
                className={styles.cover}
              />
              <div className={styles.heading}>
                <strong>{candidate.title}</strong>
                <Tooltip content={t('lyrics.preview')} relationship="label">
                  <Button
                    size="small"
                    appearance="subtle"
                    className={controls.icon}
                    icon={<ChevronRight16Regular />}
                    data-lyrics-focus={`preview:${id}`}
                    onClick={() => onPreview(candidate)}
                  />
                </Tooltip>
              </div>
              <div className={styles.byline}>
                {candidate.artists.length > 0 && (
                  <span className={styles.field}>
                    <MicRegular aria-label={t('trackInfo.artist')} />
                    <span>{listFormat.format(candidate.artists)}</span>
                  </span>
                )}
                {candidate.album && (
                  <span className={styles.field}>
                    <AlbumRegular aria-label={t('trackInfo.album')} />
                    <span>{candidate.album}</span>
                  </span>
                )}
              </div>
              <div className={styles.footer}>
                <div className={styles.metadata}>
                  <span className={styles.field}>
                    <Globe16Regular aria-label={t('lyrics.sourceLabel')} />
                    <span>{t(`lyrics.source.${candidate.source}`)}</span>
                  </span>
                  {candidate.content ? (
                    <span className={styles.field}>
                      <SoundWaveCircle16Regular aria-label={t('lyrics.format')} />
                      <span>{t(`lyrics.${kind}`)}</span>
                    </span>
                  ) : (
                    kind !== 'unknownFormat' && (
                      <span className={styles.field}>
                        <Info16Regular aria-hidden />
                        <span>{t(`lyrics.${kind}`)}</span>
                      </span>
                    )
                  )}
                  {translated && (
                    <span className={styles.field}>
                      <Translate16Regular aria-hidden />
                      <span>{t('lyrics.hasTranslation')}</span>
                    </span>
                  )}
                </div>
                <div className={styles.use}>
                  <Button
                    size="small"
                    appearance="primary"
                    data-lyrics-focus={`use:${id}`}
                    disabled={!!using}
                    onClick={() => {
                      setUsing(id);
                      void service.choose(candidate, false, subject).then((used) => {
                        if (!mounted.current) return;
                        setUsing('');
                        if (used) onUsed();
                      });
                    }}
                  >
                    {using === id ? t('lyrics.loading') : t('lyrics.use')}
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <div className={styles.actions} role="status">
        {t('lyrics.results', { count: result.candidates.length })}
      </div>
    </section>
  );
}
