import { atom } from 'jotai/vanilla';
import { localeAtom } from '../i18n/locale.ts';
import { sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';
import { playerBarStyleAtom, playerShellOf } from '../theme/playerBarStyle.ts';
import { probeCover } from '../covers/coverIdentity.ts';
import { sameBiographyPhotoPixels } from '../library/biography/biographyPhotoSimilarity.ts';
import { startAlbumArtistPhoto } from '../library/album-detail/albumArtistPhoto.ts';
import { albumsAtom } from '../library/albums.ts';
import { startArtists } from '../library/artists/artistsServices.ts';
import { startOnlineArtistBiography } from '../library/online/onlineArtistBiography.ts';
import { EMPTY_SONGS_FILTER } from '../library/songs/songsFilter.ts';
import type { AppServices } from './services.ts';
import type { BiographyIntegration } from './biographyIntegration.ts';

/** 本地与在线的艺人页共用的简介设置与资源，加上这两页都要的界面语言、照片查看器的顶边与取图探针 */
function biographyShared(biography: BiographyIntegration) {
  return {
    ...biography,
    locale: atom((get) => get(localeAtom).active),
    viewerTop: atom((get) =>
      playerShellOf(get(playerBarStyleAtom), get(sidebarViewAtom).tier === 'wide').inTitlebar
        ? 56
        : 48,
    ),
    probe: probeCover,
    same: sameBiographyPhotoPixels,
  };
}

/** 在线艺人页的简介服务：与本地艺人页共用简介资源与设置，主体由页面登记 */
export function startOnlineArtistIntegration(
  services: Pick<AppServices, 'store'>,
  biography: BiographyIntegration,
) {
  return startOnlineArtistBiography(services.store, biographyShared(biography));
}

/** 专辑详情页头的艺人头像：与艺人页共用简介资源与设置，来源跟着用户选的那个 */
export function startAlbumArtistPhotoIntegration(
  services: Pick<AppServices, 'store'>,
  biography: BiographyIntegration,
) {
  return startAlbumArtistPhoto(services.store, {
    ...biographyShared(biography),
    albums: albumsAtom,
  });
}

export function startArtistsIntegration(
  services: Pick<
    AppServices,
    | 'store'
    | 'history'
    | 'commands'
    | 'ratings'
    | 'trackActions'
    | 'albumDetail'
    | 'songs'
    | 'albumList'
    | 'configWriter'
  >,
  biography: BiographyIntegration,
) {
  return startArtists(services.store, {
    configWriter: services.configWriter,
    history: services.history,
    commands: services.commands,
    trackMenu: services.albumList.menu,
    ratingStamp: () => services.ratings.stamp(),
    biography: biographyShared(biography),
    actions: services.trackActions,
    openAlbum: (album) => services.albumDetail.open(album),
    openSongs: (query) => {
      services.history.navigate({ id: 'songs' });
      services.songs.filter.restore({
        ...EMPTY_SONGS_FILTER,
        mode: 'advanced',
        text: '',
        advancedText: query,
      });
      services.songs.rows.flush();
    },
  });
}
