import { createContext, useContext } from 'react';
import type { Atom } from 'jotai/vanilla';
import type { LibraryTrack } from 'foo-webview-sdk';
import type { MessageKey } from '../../i18n/en.ts';
import type { Album } from '../../host/libraryContract.ts';
import type { ChannelQueryService } from './channelQuery.ts';
import type { HomeChannel, HomeChannelsService } from './homeChannels.ts';
import type { HomeFeedService } from './homeFeed.ts';
import type { HomeGemMode } from './homeModel.ts';
import type { HomeOnlineService } from './homeOnline.ts';
import type { HomeOverviewService } from './homeOverview.ts';
import type { HomeRecentService } from './homeRecent.ts';
import type { HomePin, HomePinsService } from './homePins.ts';

export interface HomeServices {
  readonly feed: HomeFeedService;
  readonly recent: HomeRecentService;
  readonly overview: HomeOverviewService;
  /** 网易云的公共推荐：横幅、新歌、榜单、推荐歌单与新碟 */
  readonly online: HomeOnlineService;
  readonly pins: HomePinsService;
  readonly pinChoices: Atom<readonly HomePin[]>;
  readonly channels: HomeChannelsService;
  readonly notice: Atom<MessageKey | null>;
  /** 在页头写一条提示，null 收起；在线行里起播、入队没成时用 */
  notify(message: MessageKey | null): void;
  readonly busy: Atom<boolean>;
  readonly playChannel?: (
    channel: HomeChannel,
    tracks: readonly LibraryTrack[],
    index: number,
  ) => Promise<boolean>;
  createQuery(preview?: boolean): ChannelQueryService;
  playAlbum(album: Album): Promise<boolean>;
  playGem(track: LibraryTrack, mode: HomeGemMode): Promise<boolean>;
  /** 从最常播放的曲目榜里第 `index` 首起播这一榜 */
  playTop(tracks: readonly LibraryTrack[], index: number): Promise<boolean>;
  /** 按专辑顺序播放这位专辑艺人名下的曲目；整库曲目还没读到时不播 */
  playArtist(name: string): Promise<boolean>;
  shuffle(): Promise<boolean>;
  createAutoplaylist(channel: HomeChannel): Promise<boolean>;
  openGems(mode: HomeGemMode): void;
  /** 打开艺人墙，不选中哪一位 */
  openArtists(): void;
  /** 打开歌曲页，只留播放过的曲目，按播放次数从多到少排；歌曲页的排序偏好随之改掉 */
  openMostPlayed(): void;
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
