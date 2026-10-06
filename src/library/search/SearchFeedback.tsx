import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { albumsAtom } from '../albums.ts';
import type { SearchResultsService } from './searchResults.ts';
import styles from './SearchFeedback.module.css';

export function SearchFeedback({ results }: { readonly results: SearchResultsService }) {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(results.state);
  const albums = useAtomValueRawSync(results.albums);
  const catalog = useAtomValueRawSync(albumsAtom);
  if (!state.text) return null;
  const retry = (
    <Button size="small" onClick={() => results.retry()}>
      {t('album.retry')}
    </Button>
  );
  return (
    <div className={styles.root} aria-live="polite">
      {state.status === 'loading' && <Spinner size="tiny" label={t('album.loading')} />}
      {state.status === 'unavailable' && (
        <div>
          {t('host.unavailable')} {retry}
        </div>
      )}
      {state.status === 'disabled' && <div>{t('album.disabledTitle')}</div>}
      {state.status === 'failed' && (
        <div role="status">
          {t('search.trackFailed')} {retry}
        </div>
      )}
      {catalog.status === 'failed' && (
        <div role="status">
          {t('search.albumFailed')} {retry}
        </div>
      )}
      {catalog.truncated && <div>{t('search.limited', { count: catalog.albums.length })}</div>}
      {state.status === 'ready' &&
        catalog.status === 'ready' &&
        state.total === 0 &&
        albums.length === 0 && (
          <div>{t(state.libraryEmpty ? 'album.empty' : 'search.noMatch')}</div>
        )}
      {state.moreFailed && <div role="status">{t('search.moreFailed')}</div>}
      {state.limited && <div>{t('search.limited', { count: state.tracks.length })}</div>}
    </div>
  );
}
