import { fb } from 'foo-webview-sdk/bridge';
import { atom, createStore } from 'jotai/vanilla';
import { startDragOut, dragOutKey } from '../host/dragOut.ts';
import { startLocale, localeKey } from '../i18n/locale.ts';
import { startCommandRegistry, type CommandRegistry, commandsKey } from '../nav/commandRegistry.ts';
import { registerFullscreenCommand } from '../nav/fullscreenCommand.ts';
import { registerNavCommands } from '../nav/navCommands.ts';
import { startNavHistory, type NavHistoryService, historyKey } from '../nav/navHistory.ts';
import { EMPTY_GENRE } from '../nav/places.ts';
import { loadStartPlace } from '../nav/startPlace.ts';
import { startSidebarPrefs, sidebarPrefsKey } from '../nav/sidebar/sidebarPrefs.ts';
import { startSidebarView, sidebarViewKey } from '../nav/sidebar/sidebarView.ts';
import type { AlbumDetailService } from '../library/album-detail/albumDetail.ts';

import {
  startAlbumList,
  type AlbumListServices,
  albumListKey,
} from '../library/album-list/albumList.ts';
import { startAlbumServices, type AlbumServices, albumsKey } from '../library/albumServices.ts';
import { libraryNotConfiguredAtom } from '../library/albums.ts';
import { playcountMissingAtom } from '../library/playStats.ts';
import { trackPathOf } from '../host/libraryContract.ts';
import { startSongs, type SongsServices, songsKey } from '../library/songs/songsServices.ts';
import { startGenres, genresKey } from '../library/genres/genresServices.ts';
import { startGenreValues, genreValuesKey } from '../library/genreValues.ts';
import { startFolders, foldersKey } from '../library/folders/foldersServices.ts';
import { genresQuery } from '../library/genres/genresModel.ts';
import { genresSubject } from '../library/genres/genresSubject.ts';
import { startMainMenu, mainMenuKey } from '../shell/mainMenu.ts';
import { loadMotionChoice, watchReducedMotion } from '../motion/reducedMotion.ts';
import { startNowPlaying } from '../playback/now-playing/nowPlaying.ts';
import { startNowPlayingMenu, nowPlayingMenuKey } from '../playback/now-playing/nowPlayingMenu.ts';
import { startOutputDevices, outputDevicesKey } from '../shell/player/volume/outputDevices.ts';
import { startPlayback } from '../playback/playback.ts';
import type { PlaybackService } from '../playback/playbackContract.ts';
import { positionClockKey, startPositionClock } from '../playback/positionClock.ts';
import {
  startPlaybackSource,
  type PlaybackSourceService,
  playbackSourceKey,
} from '../playback/playbackSource.ts';
import { loadPlayerBarStyle } from '../theme/playerBarStyle.ts';
import { startQueueCount, queueCountKey } from '../playback/queueCount.ts';
import { loadVolumeScale } from '../playback/volumeScale.ts';
import { playingTrackKeyAtom } from '../playback/playingTrack.ts';
import { createPlaylistActions, playlistActionsKey } from '../playlist/playlistActions.ts';
import { startPlaylistPageServices, playlistPageKey } from '../playlist/playlistPageServices.ts';
import {
  startPlaylistPlaces,
  type PlaylistPlaces,
  playlistPlacesKey,
} from '../playlist/playlistPlaces.ts';
import { startPlaylistRows, playlistRowsKey } from '../playlist/playlistRows.ts';
import { startPlaylists, playlistsKey } from '../playback/playlists.ts';
import {
  ratingsRefetchAtom,
  startTrackRatings,
  type TrackRatingsService,
  ratingsKey,
} from '../track/trackRatings.ts';
import { watchColorScheme } from '../theme/colorScheme.ts';
import { browserMatchMedia } from '../theme/mediaQuery.ts';
import {
  startBackdrop,
  backdropKey,
  backdropNoticeAtom,
  backdropDiagnosticsAtom,
} from '../theme/backdrop.ts';
import { hasBlockingAtom, startInfoCenter, infoCenterKey } from '../host/infoCenter.ts';
import type { Store } from '../kit/store.ts';
import type { BrowserDataWriter } from '../kit/browserDataStorage.ts';
import { createConfigWriter, type ConfigWriter } from '../host/configWrite.ts';
import { startTray, trayKey } from '../playback/tray.ts';
import { desktopLyricsSwitchesAtom } from '../lyrics/desktop/desktopLyricsPrefs.ts';
import { createTrayIcons } from '../shell/trayIcons.ts';
import { startWindowShell, windowShellKey } from '../host/windowShell.ts';
import { startWindowZoom, windowZoomKey } from '../host/windowZoom.ts';
import { startWindowActivity } from '../host/windowActivity.ts';
import { startMiniWindow, miniWindowKey } from '../host/miniWindow.ts';
import { startWindowTitle } from '../playback/windowTitle.ts';
import type { RightCardServices } from '../shell/right-card/rightCardServices.ts';
import { startSearchServices, searchKey } from '../library/search/searchServices.ts';
import { onlineSourcesKey, startOnlineSources } from '../library/search/online/onlineSources.ts';
import { playbackKey } from '../playback/playbackContract.ts';
import { bindService, type ServiceBinding, type ServiceKey } from '../kit/serviceKey.ts';
import {
  startTrackActions,
  type TrackActionsService,
  trackActionsKey,
} from '../track/trackActions.ts';
import {
  startLoaderConfirmation,
  loaderConfirmationAtom,
  type LoaderConfirmationService,
} from '../update/loaderConfirmation.ts';
import { startUpdater, updaterKey } from '../update/updater.ts';
import { backendStateKey, startBackendConnection } from '../server/backendConnection.ts';
import { connectDevBackend } from '../server/devBackend.ts';
import { musicClientKey, startMusicClient } from '../playback/musicClient.ts';
import { musicStatusKey, startMusicStatus } from '../playback/musicStatus.ts';
import { ONLINE_QUALITY, onlineQualityKey, startOnlineQuality } from '../playback/onlineQuality.ts';
import { onlineTracksKey, startOnlineTracks } from '../playback/onlineTracks.ts';
import { onlineListsKey, startOnlineLists } from '../playback/onlineLists.ts';
import { createTrackArtwork, trackArtworkKey, type TrackArtwork } from '../covers/trackArtwork.ts';
import { onlinePlaybackKey, startOnlinePlayback } from '../playback/onlinePlayback.ts';
import { onlineFailuresKey, startOnlineFailures } from '../playback/onlineFailures.ts';
import {
  artistAlbumSearchKey,
  startArtistAlbumSearch,
} from '../library/online/artistAlbumSearch.ts';
import { artistAlbumsKey, startArtistAlbums } from '../library/online/artistAlbums.ts';
import { ncmSetupKey, startNcmSetup } from '../library/search/online/ncmSetup.ts';
import { createOnlinePlay, onlinePlayKey } from '../library/search/online/onlinePlay.ts';
import { startBackendBootstrap, backendBootstrapKey } from '../update/backendBootstrap.ts';
import { startPluginUpdater, pluginUpdaterKey } from '../update/pluginUpdater.ts';
import { startChangelogView, changelogViewKey } from '../update/changelogView.ts';
import { updateNotice } from './updateIntegration.ts';
import { startObjectOpeners } from './objectOpeners.ts';
import { startQueueAndCard } from './queueServices.ts';
import { startOnboarding, onboardingKey } from '../settings/onboarding/onboarding.ts';
import { startupOverlay } from './startupOverlay.ts';
import { immersiveIntegrationKey, startImmersiveIntegration } from './immersiveIntegration.ts';
import {
  prefSaveStatesAtom,
  prefStorageAvailableAtom,
  prefStorageKey,
  type PagePrefStorage,
} from '../kit/prefStorage.ts';

/**
 * 整页的服务。只有一份：在首帧之前建好，随页面存活；状态都写在 `store` 里。组件经 `useService(键)` 取单个
 * 服务，这里只留装配层（`app/` 的各个 Root 与整合）直接要用的几项
 */
export interface AppServices {
  readonly startup: LoaderConfirmationService;
  readonly store: Store;
  /** 各项宿主偏好共用的持久化入口，生命周期由页面管理 */
  readonly configWriter: Pick<ConfigWriter, 'set'>;
  readonly history: NavHistoryService;
  /** 按键与鼠标侧键的命令登记处，监听挂在 window 上 */
  readonly commands: CommandRegistry;
  readonly playback: PlaybackService;
  /** 按一批路径起播、入队、发送与执行宿主命令，失败与忙碌的提示整页一份 */
  readonly trackActions: TrackActionsService;
  readonly albums: AlbumServices;
  /** 侧边栏点列表时去它的地点，并让历史认得列表主体 */
  readonly playlistPlaces: PlaylistPlaces;
  /** 曲目评分：各张表与面板共用一份 */
  readonly ratings: TrackRatingsService;
  /** 专辑页的列表形态：整库曲目、排序、两层折叠、多选与曲目菜单 */
  readonly albumList: AlbumListServices;
  /** 正在播的从哪来：主题起播时记下，宿主那边换了表时跟着改，跨重启保留 */
  readonly playbackSource: PlaybackSourceService;
  /** 专辑详情页：进页前取曲目，正在看的几张跟着库变更重取 */
  readonly albumDetail: AlbumDetailService;
  /** 歌曲页：筛选、宿主排好的顺序与按查询填表的起播 */
  readonly songs: SongsServices;
  /** 右侧卡的开合、换页与宽度；队列服务另有自己的键 */
  readonly rightCard: RightCardServices;
  /** 取曲目封面，在线曲目也认得；页面外的取图服务（窗口取色）用 */
  readonly artwork: TrackArtwork;
  /** 全部服务与它们的键 */
  readonly bindings: readonly ServiceBinding[];
  /** 释放全部订阅、监听与定时器，按启动的逆序 */
  dispose(): void;
}

/** 启动时逐个记下释放与键：释放倒着来，后启动的先停，依赖它的总比它先停 */
function serviceScope() {
  const stops: (() => void)[] = [];
  const bindings: ServiceBinding[] = [];
  function bind<T>(key: ServiceKey<T>, service: T): T {
    bindings.push(bindService(key, service));
    return service;
  }
  return {
    bindings,
    bind,
    /** 停止函数，如监听的退订 */
    stop(stop: () => void): void {
      stops.push(stop);
    },
    own<T extends { dispose(): void }>(service: T): T {
      stops.push(() => service.dispose());
      return service;
    },
    /** 要释放、组件又要取用的服务 */
    add<T extends { dispose(): void }>(key: ServiceKey<T>, service: T): T {
      stops.push(() => service.dispose());
      return bind(key, service);
    },
    dispose(): void {
      for (let at = stops.length - 1; at >= 0; at -= 1) stops[at]?.();
    },
  };
}

/**
 * 建 store 并启动各服务。深浅、减弱动效与浏览器语言在这里同步定下，首帧就是对的；
 * 宿主那一侧的初读随后异步到。写入助手与偏好存储由调用方先建好（偏好要在服务之前读完），这里接管释放：
 * 偏好存储先于写入助手释放
 */
export function startServices(dataWriter: BrowserDataWriter, prefs: PagePrefStorage): AppServices {
  const store = createStore();
  const scope = serviceScope();
  scope.own(dataWriter);
  scope.own(prefs);
  scope.bind(prefStorageKey, prefs);
  store.set(prefStorageAvailableAtom, prefs.available);
  const publishSaving = () => store.set(prefSaveStatesAtom, prefs.snapshot());
  scope.stop(prefs.subscribe(publishSaving));
  publishSaving();
  const startup = scope.own(startLoaderConfirmation(store));
  const connection = scope.own(startBackendConnection(store));
  scope.bind(backendStateKey, connection);
  const backend = scope.add(
    backendBootstrapKey,
    startBackendBootstrap(store, connection, {
      storageAvailable: prefs.available,
    }),
  );
  if (import.meta.env.DEV) {
    // 引导的互信链是给磁盘上的安装定的，开发服务器页面用不上；短路为自取身份直连/拉起，失败保持不可用
    void connectDevBackend(connection).catch(() => {});
  }
  const configWriter = createConfigWriter(fb, dataWriter);
  const updater = scope.add(
    updaterKey,
    startUpdater(store, { writer: configWriter, storageAvailable: prefs.available }),
  );
  scope.add(pluginUpdaterKey, startPluginUpdater(store, updater, backend, connection));
  const changelog = scope.add(changelogViewKey, startChangelogView(store, updater, configWriter));
  const media = browserMatchMedia();
  scope.stop(watchColorScheme(store, media));
  loadMotionChoice(store);
  scope.stop(watchReducedMotion(store, media));
  scope.add(localeKey, startLocale(store, fb, undefined, dataWriter));
  scope.add(backdropKey, startBackdrop(store));
  scope.add(windowZoomKey, startWindowZoom(store));
  const history = scope.bind(historyKey, startNavHistory(store, loadStartPlace(store)));
  const commands = scope.add(commandsKey, startCommandRegistry(window));
  scope.stop(registerNavCommands(commands, history));
  scope.stop(registerFullscreenCommand(commands));
  const music = scope.add(musicClientKey, startMusicClient(connection));
  const onlineTracks = scope.add(onlineTracksKey, startOnlineTracks(store, music, connection.port));
  const artwork = scope.bind(trackArtworkKey, createTrackArtwork(store, onlineTracks));
  const playback = scope.add(playbackKey, startPlayback(store, fb, onlineTracks));
  scope.add(positionClockKey, startPositionClock());
  loadVolumeScale(store);
  scope.own(startNowPlaying(store, artwork));
  const windowShell = scope.add(windowShellKey, startWindowShell(store));
  scope.own(startWindowActivity(store, windowShell));
  scope.add(miniWindowKey, startMiniWindow(store, prefs, windowShell));
  scope.add(
    immersiveIntegrationKey,
    startImmersiveIntegration(store, { history, commands, playback, windowShell }),
  );
  scope.own(startWindowTitle(store));
  scope.add(mainMenuKey, startMainMenu(store));
  scope.add(
    trayKey,
    startTray(store, {
      playback,
      icon: createTrayIcons(),
      configWriter,
      desktopLyrics: desktopLyricsSwitchesAtom,
    }),
  );
  const dragOut = scope.add(dragOutKey, startDragOut());
  const playbackSource = scope.add(
    playbackSourceKey,
    startPlaybackSource(store, undefined, configWriter),
  );
  const trackActions = scope.add(trackActionsKey, startTrackActions(store, playbackSource));
  const musicStatus = scope.add(
    musicStatusKey,
    startMusicStatus(store, music, async () => {
      // 连着时不重走引导；判停或没连上时由引导重连：原进程还活着就接上，否则另起
      if (store.get(connection.failed) || store.get(connection.port) === null)
        await backend.retry();
    }),
  );
  const onlineSources = scope.add(
    onlineSourcesKey,
    startOnlineSources(store, { status: musicStatus, client: music }),
  );
  scope.add(ncmSetupKey, startNcmSetup(store, music));
  scope.add(onlineListsKey, startOnlineLists(store, music, connection.port));
  scope.add(artistAlbumsKey, startArtistAlbums(store, music, connection.port));
  scope.add(artistAlbumSearchKey, startArtistAlbumSearch(store, music));
  scope.add(onlineQualityKey, startOnlineQuality(store, configWriter));
  scope.bind(
    onlinePlayKey,
    createOnlinePlay(store, {
      port: connection.port,
      failed: connection.failed,
      quality: ONLINE_QUALITY.atom,
      actions: trackActions,
      tracks: onlineTracks,
    }),
  );
  scope.add(onlinePlaybackKey, startOnlinePlayback(store, connection.port, playback));
  scope.add(onlineFailuresKey, startOnlineFailures(store, music));
  const albums = scope.add(
    albumsKey,
    startAlbumServices(store, dragOut, trackActions, fb, configWriter),
  );
  scope.bind(sidebarPrefsKey, startSidebarPrefs(store));
  loadPlayerBarStyle(store);
  scope.add(sidebarViewKey, startSidebarView(store, media));
  scope.add(queueCountKey, startQueueCount(store));
  const playlists = scope.add(playlistsKey, startPlaylists(store));
  const ratings = scope.add(ratingsKey, startTrackRatings(store));
  const { albumDetail, objects } = startObjectOpeners(store, scope, {
    history,
    ratings,
    playlists,
    folders: () => folders,
  });
  const playlistPlaces = scope.add(
    playlistPlacesKey,
    startPlaylistPlaces(store, history, playlists, objects),
  );
  scope.bind(
    playlistActionsKey,
    createPlaylistActions(store, playlistPlaces, playlists, fb, playbackSource),
  );
  const albumList = scope.add(
    albumListKey,
    startAlbumList(
      store,
      {
        stamp: () => ratings.stamp(),
        updateCollapsed: (change) => albums.browse.updateCollapsed(change),
        play: trackActions,
      },
      fb,
      configWriter,
    ),
  );
  const playlistRows = scope.add(
    playlistRowsKey,
    startPlaylistRows(store, { stamp: () => ratings.stamp(), refetch: ratingsRefetchAtom }),
  );
  scope.add(
    playlistPageKey,
    startPlaylistPageServices(store, {
      configWriter,
      rows: playlistRows,
      places: playlistPlaces,
      stamp: () => ratings.stamp(),
      playingKey: playingTrackKeyAtom,
      artwork,
    }),
  );
  scope.add(outputDevicesKey, startOutputDevices(store));
  const infoCenter = scope.add(
    infoCenterKey,
    startInfoCenter(
      store,
      {
        playcountMissing: playcountMissingAtom,
        libraryNotConfigured: libraryNotConfiguredAtom,
      },
      fb,
      configWriter,
      prefs,
      { failed: atom((get) => get(loaderConfirmationAtom) === 'failed'), retry: startup.confirm },
      {
        notice: updateNotice(updater),
        restart: updater.restart,
        check: updater.check,
        install: updater.install,
        showChangelog: changelog.show,
        backend: {
          failed: atom((get) => get(backend.status).phase === 'failed'),
          retry: backend.retry,
        },
      },
      { notice: backdropNoticeAtom, diagnostics: backdropDiagnosticsAtom },
    ),
  );
  scope.add(
    onboardingKey,
    startOnboarding(store, {
      writer: configWriter,
      checked: infoCenter.ready,
      blocking: hasBlockingAtom,
      shown: startupOverlay.hidden(),
    }),
  );
  scope.add(nowPlayingMenuKey, startNowPlayingMenu(store, { pathOf: trackPathOf }));
  const genreValues = scope.add(genreValuesKey, startGenreValues(store, albumList.tracks));
  const songs = scope.add(
    songsKey,
    startSongs(store, { history, record: (source) => playbackSource.record(source) }),
  );
  scope.add(
    genresKey,
    startGenres(store, {
      history,
      genreValues,
      record: (keys, name) =>
        playbackSource.record({ kind: 'genre', subject: genresSubject(keys), name }),
      openSongs: (keys, fill) => {
        const query = fill?.query ?? genresQuery(keys);
        if (!keys.includes(EMPTY_GENRE) && query === genresQuery(keys)) {
          songs.openWithGenres(keys);
          return;
        }
        if (query === null) return;
        history.navigate({ id: 'songs' });
        songs.filter.clear();
        songs.filter.setQuery({ mode: 'advanced', text: '', advancedText: query });
        songs.rows.flush();
      },
    }),
  );
  const folders = scope.add(
    foldersKey,
    startFolders(store, {
      history,
      openPlaylist: (subject) => playlistPlaces.open(subject),
      stamp: () => ratings.stamp(),
      record: (subject, name) => playbackSource.record({ kind: 'folder', subject, name }),
    }),
  );
  const search = scope.add(
    searchKey,
    startSearchServices(store, {
      catalog: albums.browse,
      actions: trackActions,
      configWriter,
      music,
      sources: onlineSources,
      port: connection.port,
      findAlbum: (track) => albumDetail.findAlbum(track),
      stamp: () => ratings.stamp(),
    }),
  );
  const rightCard = startQueueAndCard(store, scope, { artwork, history, objects, search });
  return {
    store,
    startup,
    configWriter,
    history,
    commands,
    playback,
    trackActions,
    albums,
    playlistPlaces,
    ratings,
    albumList,
    playbackSource,
    albumDetail,
    songs,
    rightCard,
    artwork,
    bindings: scope.bindings,
    dispose: () => scope.dispose(),
  };
}
