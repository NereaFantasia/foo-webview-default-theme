import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import type { BiographyLibraryService } from './biographyLibrary.ts';
import styles from './BiographyLibraryInfo.module.css';

export function BiographyLibraryInfo({
  service,
  locale,
  t,
  collaborators = false,
}: {
  readonly service: BiographyLibraryService;
  readonly locale: string;
  readonly t: BiographyTranslate;
  readonly collaborators?: boolean;
}) {
  const state = useAtomValueRawSync(service.state);
  if (!state.artist) return null;
  const summary = state.summary;
  if (collaborators)
    return summary?.collaborators.length ? (
      <div className={styles.collaborators} data-biography-collaborators>
        <span>{t('biography.collaborators')}</span> {summary.collaborators.join(' · ')}
      </div>
    ) : null;
  if (!summary?.tracks && !state.loading && !state.failed) return null;
  const number = new Intl.NumberFormat(locale);
  const minutes = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
  });
  const hours = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  });
  return (
    <div className={styles.root} aria-label={t('biography.localCredits')} data-biography-library>
      {summary && summary.tracks > 0 && (
        <div>
          {number.format(summary.tracks)}{' '}
          {t(summary.tracks === 1 ? 'biography.trackOne' : 'biography.trackCount')}
          {' · '}
          {summary.duration >= 3600
            ? hours.format(summary.duration / 3600)
            : minutes.format(Math.round(summary.duration / 60))}
          {summary.albums > 0 && (
            <>
              {' · '}
              {number.format(summary.albums)}{' '}
              {t(summary.albums === 1 ? 'biography.albumOne' : 'biography.albumCount')}
            </>
          )}
          {summary.appearances > 0 && (
            <>
              {' · '}
              {number.format(summary.appearances)}{' '}
              {t(
                summary.appearances === 1 ? 'biography.guestAlbumOne' : 'biography.guestAlbumCount',
              )}
            </>
          )}
        </div>
      )}
      <div className={styles.status} role="status">
        {state.loading && <Spinner size="tiny" aria-label={t('biography.localLoading')} />}
        {state.truncated && t('biography.localTruncated')}
        {state.failed && (
          <>
            <span>{t('biography.localFailed')}</span>
            <Button appearance="transparent" size="small" onClick={() => service.refresh()}>
              {t('biography.retry')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
