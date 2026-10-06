import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { BiographyPanel } from '../../biography/BiographyPanel.tsx';
import { useArtists } from '../artistsContext.ts';
import { matchSimilar } from '../artistTops.ts';
import { ArtistMissingAlbums } from './ArtistMissingAlbums.tsx';
import { ArtistPhotoGallery } from '../photos/ArtistPhotoGallery.tsx';

export function ArtistAbout() {
  const { biography, compilation, catalog, places } = useArtists();
  const known = useAtomValueRawSync(catalog.all);
  const state = useAtomValueRawSync(biography.service.state);
  const images = useAtomValueRawSync(biography.artistImages.state);
  const links = useMemo(
    () =>
      new Map(
        matchSimilar(
          (state.details?.similar ?? []).map((item) => ({ ...item, match: 0 })),
          known.map((row) => row.name),
        ).flatMap((item) =>
          item.local
            ? [
                [
                  item.artist,
                  () => {
                    if (item.local) places.open(item.local);
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    [state.details, known, places],
  );
  const subject = useAtomValueRawSync(biography.subject);
  const language = useAtomValueRawSync(biography.language);
  const combined = useAtomValueRawSync(compilation);
  const t = useAtomValueRawSync(translateAtom);
  if (combined || subject === null) return null;
  return (
    <div data-artist-about>
      <BiographyPanel
        layout="about"
        heading={t('artists.about')}
        artist={subject}
        language={language}
        service={biography.service}
        identity={biography.identity}
        prefs={biography.prefs}
        artistLinks={links}
        artistImages={images}
        t={t}
        onRefresh={biography.refresh}
        onOpenSettings={biography.openSettings}
      />
      <ArtistMissingAlbums key={`albums:${subject}`} />
      <ArtistPhotoGallery key={`photos:${subject}`} />
    </div>
  );
}
