import { useEffect, useState, type ReactNode } from 'react';
import { ArtistsContext } from '../library/artists/artistsContext.ts';
import type { ArtistsServices } from '../library/artists/artistsServices.ts';
import type { AppServices } from './services.ts';
import type { BiographyIntegration } from './biographyIntegration.ts';
import { startArtistsIntegration } from './artistsIntegration.ts';

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
  useEffect(() => {
    const next = startArtistsIntegration(services, biography);
    setArtists(next);
    return () => next.dispose();
  }, [services, biography]);
  return <ArtistsContext value={artists}>{children}</ArtistsContext>;
}
