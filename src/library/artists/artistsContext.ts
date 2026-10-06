import { createContext, useContext } from 'react';
import type { ArtistsServices } from './artistsServices.ts';

export const ArtistsContext = createContext<ArtistsServices | null>(null);
export function useArtists(): ArtistsServices {
  const services = useContext(ArtistsContext);
  if (!services) throw new Error('艺人服务尚未挂载');
  return services;
}
