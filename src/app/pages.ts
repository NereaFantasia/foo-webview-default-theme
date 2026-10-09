import type { ComponentType } from 'react';
import { AlbumDetailPage } from '../library/album-detail/AlbumDetailPage.tsx';
import { AlbumsPage } from '../library/albums/AlbumsPage.tsx';
import { SongsPage } from '../library/songs/SongsPage.tsx';
import { GenresPage } from '../library/genres/GenresPage.tsx';
import { FoldersPage } from '../library/folders/FoldersPage.tsx';
import { PlaylistPage } from '../playlist/PlaylistPage.tsx';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { SearchPage } from '../library/search/SearchPage.tsx';
import type { PageProps, PlaceId } from '../nav/places.ts';
import { ARTISTS_PAGES } from '../library/artists/page/ArtistsPage.tsx';
import { HomePage } from '../library/home/HomePage.tsx';
import { ChannelPage } from '../library/home/ChannelPage.tsx';
import { deferPage } from './DeferredPage.tsx';

const NowPlayingPage = deferPage(() =>
  import('./ImmersivePage.tsx').then((module) => module.ImmersivePage),
);
const VideoPage = deferPage(() =>
  import('../video/VideoPage.tsx').then((module) => module.VideoPage),
);

/** 各地点的页面。没登记的地点显示占位页；页面按所在的历史记录登记快照，见 `usePageSnapshot`。 */
export const PAGES: Partial<Record<PlaceId, ComponentType<PageProps>>> = {
  ...ARTISTS_PAGES,
  home: HomePage,
  channel: ChannelPage,
  video: VideoPage,
  search: SearchPage,
  albums: AlbumsPage,
  album: AlbumDetailPage,
  settings: SettingsPage,
  nowPlaying: NowPlayingPage,
  playlist: PlaylistPage,
  songs: SongsPage,
  genres: GenresPage,
  folders: FoldersPage,
};
