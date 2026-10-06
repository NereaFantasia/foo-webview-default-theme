import type { ConfigWriter } from '../host/configWrite.ts';
import type { Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { startPlaylistCovers, type PlaylistCoversService } from './groups/playlistCovers.ts';
import { startPlaylistDuration, type PlaylistDurationService } from './playlistDuration.ts';
import { startPlaylistFilter, type PlaylistFilterService } from './filter/playlistFilter.ts';
import { startPlaylistGroups, type PlaylistGroupsService } from './groups/playlistGroups.ts';
import { startPlaylistLocate, type PlaylistLocateService } from './playlistLocate.ts';
import type { PlaylistPlaces } from './playlistPlaces.ts';
import type { PlaylistRowsService } from './playlistRows.ts';
import { startPlaylistSelection, type PlaylistSelectionService } from './playlistSelection.ts';
import { createPlaylistTrackActions, type PlaylistTrackActions } from './playlistTrackActions.ts';
import { createPlaylistTrackMenu, type PlaylistTrackMenuService } from './playlistTrackMenu.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/** 播放列表页要的服务，页面这一侧只建一份，几张列表的页共用，各自按 GUID 取。 */
export interface PlaylistPageServices {
  readonly selection: PlaylistSelectionService;
  readonly groups: PlaylistGroupsService;
  readonly covers: PlaylistCoversService;
  readonly filter: PlaylistFilterService;
  readonly locate: PlaylistLocateService;
  readonly tracks: PlaylistTrackActions;
  readonly menu: PlaylistTrackMenuService;
  /** 页头的总时长。 */
  readonly duration: PlaylistDurationService;
  dispose(): void;
}

export interface PlaylistPageDeps {
  readonly configWriter?: Pick<ConfigWriter, 'set'>;
  readonly rows: PlaylistRowsService;
  readonly places: Pick<PlaylistPlaces, 'open'>;
  /** 评分服务的戳，见 `TrackRatingsService.stamp`：过滤每次扫描之前拿一次。 */
  readonly stamp: () => number;
  /** 正在播放那一首的键，停止时为空串；定位正在播放用。 */
  readonly playingKey: Atom<string>;
}

/** 建齐播放列表页的服务。行服务、列表跳转与评分归外面，这里只接着用。 */
export function startPlaylistPageServices(
  store: Store,
  deps: PlaylistPageDeps,
): PlaylistPageServices {
  const { rows } = deps;
  const selection = startPlaylistSelection(store, { rows });
  const groups = startPlaylistGroups(store, { rows });
  const covers = startPlaylistCovers(store, { rows, groups });
  const filter = startPlaylistFilter(
    store,
    { rows, stamp: deps.stamp },
    undefined,
    deps.configWriter,
  );
  const locate = startPlaylistLocate(store, {
    places: deps.places,
    rows,
    playingKey: deps.playingKey,
  });
  const tracks = createPlaylistTrackActions(store, { selection });
  const menu = createPlaylistTrackMenu(store, { selection, rows });
  const duration = startPlaylistDuration(store, { rows });
  return {
    selection,
    groups,
    covers,
    filter,
    locate,
    tracks,
    menu,
    duration,
    dispose() {
      menu.dispose();
      duration.dispose();
      locate.dispose();
      filter.dispose();
      covers.dispose();
      groups.dispose();
      selection.dispose();
    },
  };
}

export const playlistPageKey = serviceKey<PlaylistPageServices>('playlistPage');
