import { atom } from 'jotai/vanilla';
import type { TrackArtwork } from '../covers/trackArtwork.ts';
import type { ServiceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { SearchServices } from '../library/search/searchServices.ts';
import type { NavHistoryService } from '../nav/navHistory.ts';
import type { ObjectOpener } from '../nav/objectOpener.ts';
import { sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';
import { LIBRARY_VIEW_PLAYLIST } from '../playback/libraryView.ts';
import { currentTrackAtom, playbackAtom, playbackOrderAtom } from '../playback/playback.ts';
import { playbackSourceAtom, refOfSource, sourceHome } from '../playback/playbackSource.ts';
import { queueKey, startQueueServices } from '../playback/queue/queueServices.ts';
import { rightCardKey, startRightCardServices } from '../shell/right-card/rightCardServices.ts';

interface ServiceScope {
  add<T extends { dispose(): void }>(key: ServiceKey<T>, service: T): T;
}

/**
 * 播放队列与右侧卡。队列服务只管队列，卡只管开合、换页与宽度；两边都要的当前曲目、播放来源与「去来源」
 * 在这里各建一份交给它们。队列先建先停，卡停时队列还在
 */
export function startQueueAndCard(
  store: Store,
  scope: ServiceScope,
  deps: {
    readonly artwork: TrackArtwork;
    readonly history: Pick<NavHistoryService, 'navigate'>;
    readonly objects: Pick<ObjectOpener, 'open'>;
    readonly search: Pick<SearchServices, 'request'>;
  },
) {
  const stopped = atom((get) => get(playbackAtom).state === 'stopped');
  const openSource = () => {
    const source = store.get(playbackSourceAtom);
    if (!source) return;
    // 在线搜索回到那次查询的在线音乐范围；结果页按查询词认领这条请求
    if (source.kind === 'online')
      store.set(deps.search.request, { text: source.subject, scope: 'online', category: 'tracks' });
    const ref = refOfSource(source);
    if (ref) void deps.objects.open(ref);
    else deps.history.navigate(sourceHome(source));
  };
  scope.add(
    queueKey,
    startQueueServices(store, {
      artwork: deps.artwork,
      order: playbackOrderAtom,
      stopped,
      current: currentTrackAtom,
      source: playbackSourceAtom,
      libraryList: LIBRARY_VIEW_PLAYLIST,
      openSource,
      openPlaylist: (guid) => void deps.objects.open({ kind: 'playlist', guid }),
    }),
  );
  return scope.add(
    rightCardKey,
    startRightCardServices(store, {
      wide: atom((get) => get(sidebarViewAtom).tier === 'wide'),
      stopped,
      playbackState: atom((get) => get(playbackAtom).state),
      current: currentTrackAtom,
      source: playbackSourceAtom,
      openSource,
    }),
  );
}
