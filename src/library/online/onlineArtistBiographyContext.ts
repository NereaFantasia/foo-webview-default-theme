import { createContext, useContext } from 'react';
import type { OnlineArtistBiography } from './onlineArtistBiography.ts';

export const OnlineArtistBiographyContext = createContext<OnlineArtistBiography | null>(null);

/** 简介服务由 `app/` 在装配好简介资源之后才提供；没有时页面不画「关于」 */
export function useOnlineArtistBiography(): OnlineArtistBiography | null {
  return useContext(OnlineArtistBiographyContext);
}
