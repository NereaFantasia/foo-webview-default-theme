import { useEffect, useState, type ReactNode } from 'react';
import type { AlbumArtistPhoto } from '../library/album-detail/albumArtistPhoto.ts';
import { AlbumArtistPhotoContext } from '../library/album-detail/albumArtistPhotoContext.ts';
import { ArtistsContext } from '../library/artists/artistsContext.ts';
import type { ArtistsServices } from '../library/artists/artistsServices.ts';
import type { OnlineArtistBiography } from '../library/online/onlineArtistBiography.ts';
import { OnlineArtistBiographyContext } from '../library/online/onlineArtistBiographyContext.ts';
import type { AppServices } from './services.ts';
import type { BiographyIntegration } from './biographyIntegration.ts';
import {
  startAlbumArtistPhotoIntegration,
  startArtistsIntegration,
  startOnlineArtistIntegration,
} from './artistsIntegration.ts';

export function ArtistsRoot({
  services,
  biography,
  children,
}: {
  readonly services: AppServices;
  readonly biography: BiographyIntegration;
  readonly children: ReactNode;
}) {
  const [artists, setArtists] = useState<ArtistsServices | null>(null);
  const [online, setOnline] = useState<OnlineArtistBiography | null>(null);
  const [albumPhoto, setAlbumPhoto] = useState<AlbumArtistPhoto | null>(null);
  useEffect(() => {
    const next = startArtistsIntegration(services, biography);
    setArtists(next);
    return () => next.dispose();
  }, [services, biography]);
  useEffect(() => {
    const next = startOnlineArtistIntegration(services, biography);
    setOnline(next);
    return () => next.dispose();
  }, [services, biography]);
  useEffect(() => {
    const next = startAlbumArtistPhotoIntegration(services, biography);
    setAlbumPhoto(next);
    return () => next.dispose();
  }, [services, biography]);
  return (
    <ArtistsContext value={artists}>
      <OnlineArtistBiographyContext value={online}>
        <AlbumArtistPhotoContext value={albumPhoto}>{children}</AlbumArtistPhotoContext>
      </OnlineArtistBiographyContext>
    </ArtistsContext>
  );
}
