import { Button, Spinner } from '@fluentui/react-components';
import { CalendarLtr16Regular, TextNumberListLtr16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { TrackMenu } from '../../TrackMenu.tsx';
import { albumKeyOf, albumYearOf } from '../../../host/libraryContract.ts';
import { SongArt } from '../../SongArt.tsx';
import { useArtists } from '../artistsContext.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import styles from './ArtistAlbums.module.css';
import { Metadata, MetadataItem } from '../../../kit/Metadata.tsx';

export function ArtistAlbums() {
  const services = useArtists();
  const viewControls = useViewControlStyles();
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
          <Button className={viewControls.field} size="small" onClick={services.retry}>
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
                      <Metadata className={styles.meta}>
                        {albumYearOf(album) && (
                          <MetadataItem icon={<CalendarLtr16Regular />} label={t('table.year')}>
                            {albumYearOf(album)}
                          </MetadataItem>
                        )}
                        <MetadataItem icon={<TextNumberListLtr16Regular />}>
                          {t('artists.trackCount', { count: tracks.length })}
                        </MetadataItem>
                      </Metadata>
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
