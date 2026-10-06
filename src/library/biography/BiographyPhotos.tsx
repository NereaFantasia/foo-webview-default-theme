import { Button, Spinner, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import type { BiographyTranslate } from './BiographyPanel.tsx';
import type { BiographyPhotosService, BiographyPhotosState } from './biographyPhotos.ts';
import { BiographyPhotoImage } from './BiographyPhotoImage.tsx';
import { BiographyPhotoViewer } from './BiographyPhotoViewer.tsx';
import { BiographyPhotoSource } from './online/BiographyPhotoSource.tsx';
import styles from './BiographyPhotos.module.css';

interface PhotoListProps {
  readonly state: BiographyPhotosState;
  readonly service: BiographyPhotosService;
  readonly top: number;
  readonly t: BiographyTranslate;
  readonly onRetry?: () => void;
}

function BiographyPhotoList({ state, service, top, t, onRetry }: PhotoListProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { artist, photos } = state;
  const index = Math.max(
    0,
    photos.findIndex((photo) => photo.key === selected),
  );
  const photo = photos[index];
  if (!artist) return null;
  if (!photo && !state.loading && !state.failed && !state.onlineLoading && !state.onlineProblem)
    return null;
  return (
    <div className={styles.root} data-biography-photos>
      <div className={styles.frame}>
        {photo ? (
          <button
            className={styles.photo}
            aria-label={t('biography.openPhotos')}
            onClick={() => setOpen(true)}
          >
            <BiographyPhotoImage
              url={photo.url}
              label={artist}
              missing={t('biography.photoFailed')}
            />
          </button>
        ) : (
          <div className={styles.photo}>
            <BiographyPhotoImage label={artist} missing={t('biography.noPhotos')} />
          </div>
        )}
        {(state.loading || state.onlineLoading) && (
          <div className={styles.loading}>
            <Spinner
              size="tiny"
              aria-label={t(
                state.loading ? 'biography.photosLoading' : 'biography.onlinePhotoLoading',
              )}
            />
          </div>
        )}
      </div>
      {photos.length > 1 && (
        <div className={styles.dots} aria-label={t('biography.photos')}>
          {photos.map((item, at) => (
            <Tooltip key={item.key} content={item.album} relationship="description">
              <button
                className={styles.dot}
                aria-label={`${t('biography.photo')} ${at + 1} / ${photos.length}`}
                aria-pressed={at === index}
                onClick={() => setSelected(item.key)}
              />
            </Tooltip>
          ))}
        </div>
      )}
      <div className={styles.status} role="status">
        {state.failed && t('biography.photosFailed')}
        {state.truncated && t('biography.photosTruncated')}
        {state.onlineProblem && (
          <span>
            {t('biography.onlinePhotoFailed')} ·{' '}
            {t(
              state.onlineProblem === 'invalid'
                ? 'biography.photoInvalid'
                : `biography.${state.onlineProblem}`,
            )}
          </span>
        )}
        {(state.failed || state.onlineProblem) && (
          <Tooltip content={t('biography.retry')} relationship="label">
            <Button
              appearance="subtle"
              icon={<ArrowClockwise20Regular />}
              disabled={state.loading || state.onlineLoading}
              aria-label={t('biography.retry')}
              onClick={() => (onRetry ?? service.refresh)()}
            />
          </Tooltip>
        )}
      </div>
      {photo?.sourceUrl && (
        <BiographyPhotoSource key={photo.sourceUrl} url={photo.sourceUrl} t={t} />
      )}
      {photo && (
        <BiographyPhotoViewer
          open={open}
          artist={artist}
          photos={photos}
          index={index}
          top={top}
          t={t}
          onSelect={(at) => setSelected(photos[at]?.key ?? null)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function BiographyPhotos({ service, ...props }: Omit<PhotoListProps, 'state'>) {
  const state = useAtomValueRawSync(service.state);
  return <BiographyPhotoList key={state.artist} state={state} service={service} {...props} />;
}
