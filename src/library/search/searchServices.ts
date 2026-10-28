import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { settle } from '../../host/hostCall.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { historyAtom } from '../../nav/navHistory.ts';
import type { Store } from '../../kit/store.ts';
import type { AlbumsService } from '../albums.ts';
import { albumSource } from '../albumActions.ts';
import { fetchAlbumTracks } from '../albumTracks.ts';
import { trackPathOf, type Album, type TrackAlbumFields } from '../../host/libraryContract.ts';
import { startSearchHistory, type SearchHistoryService } from './searchHistory.ts';
import type { SearchHit } from './searchQuery.ts';
import { startSearchResults, type SearchResultsService } from './searchResults.ts';
import { startSearchMenu, type SearchMenuService } from './menus/searchMenu.ts';
import {
  startOnlineSearch,
  type OnlineCategory,
  type OnlineSearch,
} from './online/onlineSearch.ts';
import type { OnlineSources } from './online/onlineSources.ts';
import type { MusicClient } from '../../playback/musicClient.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import { LIBRARY_SOURCE } from '../../playback/playbackSource.ts';
import type { TrackActionsService } from '../../track/trackActions.ts';

interface SearchDeps {
  readonly catalog: Pick<AlbumsService, 'retry'>;
  readonly actions: Pick<TrackActionsService, 'playPaths'>;
  readonly configWriter: Pick<ConfigWriter, 'set'>;
  readonly music: Pick<MusicClient, 'search'>;
  /** 在线音乐范围当前选的来源：结果页与下拉里的在线预览搜的是同一个平台 */
  readonly sources: Pick<OnlineSources, 'selected'>;
  /** 本地后端连上的端口；没取到的在线结果在连上后重取 */
  readonly port?: Atom<number | null>;
  findAlbum(track: TrackAlbumFields): Album | null;
  /** 评分账本的代数，右键菜单的评分项按它判断是否过期 */
  stamp(): number;
}

export type SearchCategory = 'all' | 'artists' | 'albums' | 'tracks';

/** 结果页落在哪个范围的哪一类；范围与分类都是页内状态，不进历史 */
export type SearchTarget =
  | { readonly scope: 'library'; readonly category: SearchCategory }
  | {
      readonly scope: 'online';
      readonly category: OnlineCategory;
      /** 落到那一类后选中并滚到这首曲目（平台内的 ID） */
      readonly focus?: string;
    };

export interface SearchServices {
  readonly recent: SearchHistoryService;
  readonly preview: SearchResultsService;
  /** 下拉里本地结果的右键菜单，与结果页同一套 */
  readonly previewMenu: SearchMenuService;
  /** 下拉在线音乐范围的结果，只取曲目 */
  readonly onlinePreview: OnlineSearch;
  readonly notice: Atom<MessageKey | null>;
  /**
   * 下拉里「查看 N 张」、播放来源「在线搜索」这类入口要结果页落在哪个范围的哪一类；结果页遇到同一查询词时取走
   */
  readonly request: PrimitiveAtom<(SearchTarget & { readonly text: string }) | null>;
  createResults(): SearchResultsService;
  /** 一个查询词的在线结果。最近几个查询词的留在这里，结果页不释放 */
  online(text: string): OnlineSearch;
  play(hit: SearchHit): Promise<boolean>;
  dispose(): void;
}

/**
 * 留几个查询词的在线结果：后退、前进或换页回到结果页时直接显示，不再向平台要。每进一次结果页
 * 都重搜会撞上平台的频率限制
 */
const KEPT_ONLINE = 4;

export function startSearchServices(store: Store, deps: SearchDeps): SearchServices {
  const recent = startSearchHistory(store, undefined, deps.configWriter);
  const preview = startSearchResults(store, deps.catalog);
  const previewMenu = startSearchMenu(store, preview, deps);
  const onlinePreview = startOnlineSearch(store, deps.music, deps.port, deps.sources.selected);
  const kept = new Map<string, OnlineSearch>();
  const notice = atom<MessageKey | null>(null);
  const request = atom<(SearchTarget & { readonly text: string }) | null>(null);
  let disposed = false;
  let playing = false;
  return {
    recent,
    preview,
    previewMenu,
    onlinePreview,
    notice,
    request,
    createResults: () => startSearchResults(store, deps.catalog),
    online(text) {
      let search = kept.get(text);
      if (search) kept.delete(text);
      else {
        search = startOnlineSearch(store, deps.music, deps.port, deps.sources.selected);
        search.setText(text);
      }
      kept.set(text, search);
      for (const [key, old] of kept) {
        if (kept.size <= KEPT_ONLINE) break;
        old.dispose();
        kept.delete(key);
      }
      return search;
    },
    async play(hit) {
      if (disposed || playing || hit.kind === 'artist') return false;
      playing = true;
      store.set(notice, null);
      const entry = store.get(historyAtom).entry;
      const current = () => !disposed && entry === store.get(historyAtom).entry;
      try {
        const album = hit.kind === 'album' ? hit.album : deps.findAlbum(hit.track);
        let paths: readonly string[];
        let index = 0;
        if (album) {
          const tracks = await settle(() => fetchAlbumTracks(fb, album, { fresh: true }));
          if (!current()) return false;
          index =
            hit.kind === 'track'
              ? (tracks?.findIndex((track) => track.handle === hit.track.handle) ?? -1)
              : 0;
          paths = tracks?.map(trackPathOf) ?? [];
        } else {
          const track = hit.kind === 'track' ? hit.track : null;
          paths = track?.path
            ? [trackPathOf({ path: track.path, subsong: track.subsong ?? 0 })]
            : [];
        }
        const ok =
          current() &&
          paths.length > 0 &&
          index >= 0 &&
          (await deps.actions.playPaths(paths, index, album ? albumSource(album) : LIBRARY_SOURCE));
        if (current() && !ok) store.set(notice, 'album.playFailed');
        return ok;
      } finally {
        playing = false;
      }
    },
    dispose() {
      disposed = true;
      for (const search of kept.values()) search.dispose();
      onlinePreview.dispose();
      previewMenu.dispose();
      preview.dispose();
      recent.dispose();
    },
  };
}

export const searchKey = serviceKey<SearchServices>('search');
