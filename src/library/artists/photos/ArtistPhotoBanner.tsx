import { Spinner } from '@fluentui/react-components';
import { Person48Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import styles from './ArtistPhotoBanner.module.css';

export function ArtistPhotoBanner({
  url,
  label,
  loading,
  loadingLabel,
  missing,
  failed,
}: {
  readonly url?: string;
  readonly label: string;
  readonly loading: boolean;
  readonly loadingLabel: string;
  readonly missing: string;
  readonly failed: string;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const state = url ? status : loading ? 'loading' : 'empty';
  return (
    <span className={styles.root} data-artist-photo-state={state}>
      {url && status !== 'failed' && (
        <>
          <img className={styles.backdrop} src={url} alt="" aria-hidden draggable={false} />
          <img
            className={styles.foreground}
            src={url}
            alt={label}
            draggable={false}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('failed')}
            data-artist-photo-foreground
          />
        </>
      )}
      {state !== 'ready' && (
        <span className={styles.placeholder}>
          {state === 'loading' ? (
            <Spinner size="small" label={loadingLabel} />
          ) : (
            <span role="img" aria-label={state === 'failed' ? failed : missing}>
              <Person48Regular aria-hidden />
            </span>
          )}
        </span>
      )}
    </span>
  );
}
