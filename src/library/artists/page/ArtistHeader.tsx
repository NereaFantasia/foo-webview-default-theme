import { Button, Link, Tooltip } from '@fluentui/react-components';
import {
  ArrowShuffle20Regular,
  MoreHorizontal20Regular,
  ImageMultiple20Regular,
  Play20Filled,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { BiographyPhotoViewer } from '../../biography/BiographyPhotoViewer.tsx';
import { ArtistPhotoBanner } from '../photos/ArtistPhotoBanner.tsx';
import { SongArt } from '../../songs/SongArt.tsx';
import { useArtists } from '../artistsContext.ts';
import styles from './ArtistHeader.module.css';
import { ArtistPhotoTools } from '../photos/ArtistPhotoTools.tsx';

export function ArtistHeader({ onMenu }: { readonly onMenu: (x: number, y: number) => void }) {
  const services = useArtists();
  const name = useAtomValueRawSync(services.places.selected);
  const state = useAtomValueRawSync(services.detail.state);
  const compilation = useAtomValueRawSync(services.compilation);
  const photos = useAtomValueRawSync(services.biography.photos.state);
  const prefs = useAtomValueRawSync(services.prefs.state);
  const viewerTop = useAtomValueRawSync(services.biography.viewerTop);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const [viewing, setViewing] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const pictures = photos.artist === name ? photos.photos : [];
  const index = Math.max(
    0,
    pictures.findIndex((photo) => photo.key === (chosen ?? prefs.portraits[name ?? ''])),
  );
  const photo = pictures[index];
  const portrait = pictures.find((item) => item.key === prefs.portraits[name ?? '']) ?? pictures[0];
  const loading = photos.artist === name && (photos.loading || !!photos.onlineLoading);
  const openPhotos = () => {
    setChosen(portrait?.key ?? null);
    setViewing(true);
  };
  const detail = state.subject === name ? state.detail : null;
  const count = new Intl.NumberFormat(locale);
  const playable =
    detail &&
    detail.summary.tracks > 0 &&
    !state.partial &&
    !state.refreshFailed &&
    !state.guestPending;
  return (
    <header
      className={styles.root}
      data-artist-header
      data-compact={compilation || (!portrait && !loading) || undefined}
    >
      {compilation ? (
        <div className={styles.collage}>
          {Array.from({ length: 4 }, (_, at) => (
            <SongArt key={at} album={detail?.own[at]?.album} size={66} />
          ))}
        </div>
      ) : (
        <button
          className={styles.portrait}
          type="button"
          disabled={!photo}
          aria-label={t('biography.openPhotos')}
          onClick={openPhotos}
        >
          <ArtistPhotoBanner
            key={portrait?.url ?? ''}
            url={portrait?.url}
            label={name ?? ''}
            loading={loading}
            loadingLabel={t('artists.photoLoading')}
            missing={photos.failed ? t('biography.photoFailed') : t('artists.noPhoto')}
            failed={t('biography.photoFailed')}
          />
          {pictures.length > 1 && <span className={styles.badge}>{pictures.length}</span>}
        </button>
      )}
      <div className={styles.identity}>
        <div className={styles.info}>
          {compilation && <span className={styles.kind}>{t('artists.compilation')}</span>}
          <h2 title={name || t('artists.unknown')}>{name || t('artists.unknown')}</h2>
          {detail && (
            <p>
              {t('artists.summary', {
                albums: count.format(detail.summary.ownAlbums),
                guest: count.format(detail.summary.guestAlbums),
                tracks: count.format(detail.summary.tracks),
              })}
              {' · '}
              {new Intl.NumberFormat(locale, {
                style: 'unit',
                unit: 'hour',
                maximumFractionDigits: 1,
              }).format(detail.summary.duration / 3600)}
              {detail.summary.firstYear &&
                ` · ${detail.summary.firstYear}${detail.summary.lastYear !== detail.summary.firstYear ? `–${detail.summary.lastYear}` : ''}`}
            </p>
          )}
          {!compilation && !!detail?.collaborators.length && (
            <p className={styles.collaborators}>
              {t('artists.collaborators')}{' '}
              {detail.collaborators.slice(0, 5).map((artist, at) => (
                <span key={artist.name}>
                  {at > 0 && ' · '}
                  <Link onClick={() => services.places.open(artist.name)}>{artist.name}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={<Play20Filled />}
            disabled={!playable}
            onClick={() => void services.play()}
          >
            {t('artists.play')}
          </Button>
          <Button
            icon={<ArrowShuffle20Regular />}
            disabled={!playable}
            onClick={() => void services.play(0, true)}
          >
            {t('artists.shuffle')}
          </Button>
          {!compilation && (
            <Tooltip content={t('biography.photos')} relationship="label">
              <Button icon={<ImageMultiple20Regular />} disabled={!photo} onClick={openPhotos} />
            </Tooltip>
          )}
          <Button
            icon={<MoreHorizontal20Regular />}
            aria-label={t('artists.more')}
            onClick={(event) => onMenu(event.clientX, event.clientY)}
          />
        </div>
      </div>
      {!compilation && photo && (
        <BiographyPhotoViewer
          open={viewing}
          artist={name ?? ''}
          photos={pictures}
          index={index}
          top={viewerTop}
          t={t}
          commandPrefix="artists"
          actions={<ArtistPhotoTools artist={name ?? ''} photo={photo.key} />}
          onSelect={(at) => setChosen(pictures[at]?.key ?? null)}
          onClose={() => setViewing(false)}
        />
      )}
    </header>
  );
}
