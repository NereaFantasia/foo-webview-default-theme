import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { TrackMenu } from '../../TrackMenu.tsx';
import { albumKeyOf, albumYearOf } from '../../../host/libraryContract.ts';
import { SongArt } from '../../songs/SongArt.tsx';
import { useArtists } from '../artistsContext.ts';
import styles from './ArtistAlbums.module.css';

export function ArtistAlbums() {
  const services = useArtists();
  const state = useAtomValueRawSync(services.detail.state);
  const t = useAtomValueRawSync(translateAtom);
  const [menu, setMenu] = useState<{ at: TablePoint; detail: typeof state.detail } | null>(null);
  return (
    <div className={styles.root} data-artist-albums>
      {(state.status === 'loading' || state.status === 'idle') && (
        <Spinner size="small" aria-label={t('artists.loading')} />
      )}
      {(state.status === 'failed' ||
        state.refreshFailed ||
        state.partial ||
        state.guestPending) && (
        <div className={styles.notice} role="alert">
          {t(
            state.refreshFailed
              ? 'artists.refreshFailed'
              : state.partial
                ? 'artists.partial'
                : state.guestPending
                  ? 'artists.guestPending'
                  : 'artists.failed',
          )}
          <Button size="small" onClick={services.retry}>
            {t('artists.retry')}
          </Button>
        </div>
      )}
      {(['own', 'guest'] as const).map((section) => {
        const groups = state.detail?.[section] ?? [];
        if (!groups.length) return null;
        return (
          <section key={section} aria-label={t(`artists.${section}`)}>
            <h3 className={styles.heading}>{t(`artists.${section}`)}</h3>
            <ul className={styles.list}>
              {groups.map(({ album, tracks }) => (
                <li key={albumKeyOf(album)}>
                  <button
                    type="button"
                    className={styles.album}
                    onClick={() => services.openAlbum(album)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!tracks.length) return;
                      void services.trackMenu.prepare(tracks, undefined, state.stamp);
                      setMenu({ at: { x: event.clientX, y: event.clientY }, detail: state.detail });
                    }}
                  >
                    <SongArt album={album} size={56} />
                    <span className={styles.text}>
                      <span className={styles.name}>{album.name}</span>
                      <span className={styles.meta}>
                        {[albumYearOf(album), t('artists.trackCount', { count: tracks.length })]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <TrackMenu
        at={menu?.at ?? null}
        onClose={() => setMenu(null)}
        isCurrent={() => menu?.detail === state.detail}
      />
    </div>
  );
}
