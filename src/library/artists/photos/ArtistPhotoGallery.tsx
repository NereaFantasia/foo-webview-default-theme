import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { BiographyPhotoImage } from '../../biography/BiographyPhotoImage.tsx';
import { BiographyPhotoViewer } from '../../biography/BiographyPhotoViewer.tsx';
import { useArtists } from '../artistsContext.ts';
import { ArtistPhotoTools } from './ArtistPhotoTools.tsx';
import styles from './ArtistPhotoGallery.module.css';

export function ArtistPhotoGallery() {
  const { biography, prefs } = useArtists();
  const state = useAtomValueRawSync(biography.photos.state);
  const chosen = useAtomValueRawSync(prefs.state).portraits;
  const viewerTop = useAtomValueRawSync(biography.viewerTop);
  const t = useAtomValueRawSync(translateAtom);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const photo = state.photos[index];
  if (!state.artist || !state.photos.length) return null;
  return (
    <section className={styles.root} aria-label={t('biography.photos')}>
      <div className={styles.label}>
        {t('biography.photos')} · {state.photos.length}
      </div>
      <div className={styles.photos}>
        {state.photos.map((item, at) => (
          <button
            type="button"
            key={item.key}
            aria-label={`${t('biography.photo')} ${at + 1}`}
            className={styles.photo}
            data-avatar={chosen[state.artist ?? ''] === item.key || undefined}
            onClick={() => {
              setIndex(at);
              setOpen(true);
            }}
          >
            <BiographyPhotoImage
              url={item.url}
              label={item.album}
              missing={t('biography.photoFailed')}
            />
            {chosen[state.artist ?? ''] === item.key && <span>{t('artists.portrait')}</span>}
          </button>
        ))}
      </div>
      {photo && (
        <BiographyPhotoViewer
          open={open}
          artist={state.artist}
          photos={state.photos}
          index={index}
          top={viewerTop}
          t={t}
          commandPrefix="artists.about-photos"
          actions={<ArtistPhotoTools artist={state.artist} photo={photo.key} />}
          onSelect={setIndex}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
