import { atom } from 'jotai/vanilla';
import { localeAtom } from '../i18n/locale.ts';
import { sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';
import { playerBarStyleAtom, playerShellOf } from '../theme/playerBarStyle.ts';
import { probeCover, sameCoverPixels } from '../immersive/cover/coverIdentity.ts';
import { startArtists } from '../library/artists/artistsServices.ts';
import { EMPTY_SONGS_FILTER } from '../library/songs/songsFilter.ts';
import type { AppServices } from './services.ts';
import type { BiographyIntegration } from './biographyIntegration.ts';

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
    biography: {
      ...biography,
      locale: atom((get) => get(localeAtom).active),
      viewerTop: atom((get) =>
        playerShellOf(get(playerBarStyleAtom), get(sidebarViewAtom).tier === 'wide').inTitlebar
          ? 56
          : 48,
      ),
      probe: probeCover,
      same: sameCoverPixels,
    },
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
