import { createContext, useContext } from 'react';
import type { Atom } from 'jotai/vanilla';
import type { LibraryTrack } from 'foo-webview-sdk';
import type { MessageKey } from '../../i18n/en.ts';
import type { Album } from '../../host/libraryContract.ts';
import type { ChannelQueryService } from './channelQuery.ts';
import type { HomeChannel, HomeChannelsService } from './homeChannels.ts';
import type { HomeFeedService } from './homeFeed.ts';
import type { HomeGemMode } from './homeModel.ts';
import type { HomeRecentService } from './homeRecent.ts';
import type { HomePin, HomePinsService } from './homePins.ts';

export interface HomeServices {
  readonly feed: HomeFeedService;
  readonly recent: HomeRecentService;
  readonly pins: HomePinsService;
  readonly pinChoices: Atom<readonly HomePin[]>;
  readonly channels: HomeChannelsService;
  readonly notice: Atom<MessageKey | null>;
  readonly busy: Atom<boolean>;
  readonly playChannel?: (
    channel: HomeChannel,
    tracks: readonly LibraryTrack[],
    index: number,
  ) => Promise<boolean>;
  createQuery(preview?: boolean): ChannelQueryService;
  playAlbum(album: Album): Promise<boolean>;
  playGem(track: LibraryTrack, mode: HomeGemMode): Promise<boolean>;
  shuffle(): Promise<boolean>;
  createAutoplaylist(channel: HomeChannel): Promise<boolean>;
  openGems(mode: HomeGemMode): void;
  openChannel(channel: HomeChannel): void;
  openPin(pin: HomePin): void;
  dispose(): void;
}

export const HomeContext = createContext<HomeServices | null>(null);
export function useHomeServices(): HomeServices {
  const services = useContext(HomeContext);
  if (!services) throw new Error('首页服务未就绪');
  return services;
}
