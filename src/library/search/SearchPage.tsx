import { Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import type { PageProps } from '../../nav/places.ts';
import { PageEntryContext, usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { SEARCH_ONLINE } from '../../playback/searchOnlinePref.ts';
import { ratingsKey } from '../../track/trackRatings.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { albumsAtom } from '../albums.ts';
import { LibraryResults } from './LibraryResults.tsx';
import { startSearchMenu, type SearchMenuService } from './menus/searchMenu.ts';
import { unavailableCategories } from './online/OnlineControls.tsx';
import type { OnlineCategory, OnlineSearch } from './online/onlineSearch.ts';
import { OnlineResults, type OnlineResume } from './online/OnlineResults.tsx';
import { OnlineSection } from './online/OnlineSection.tsx';
import { SearchCategoryTabs } from './SearchCategoryTabs.tsx';
import { SearchHeader, type SearchRange } from './SearchHeader.tsx';
import type { SearchResultsService } from './searchResults.ts';
import { searchKey, type SearchCategory } from './searchServices.ts';
import { startSearchTracks, type SearchTracksService } from './tracks/searchTracks.ts';
import styles from './SearchPage.module.css';

type Scope = 'library' | 'online';
/** 各分类选的范围；没选过的是媒体库，歌单只有在线音乐 */
type Scopes = Readonly<Partial<Record<Exclude<OnlineCategory, 'playlists'>, Scope>>>;
/**
 * 分类与各分类的范围单独存：在线音乐范围里没有本地的滚动区，本地那份快照这时不登记。
 * 开着「搜索时包含在线音乐」时「全部」不分范围，媒体库与在线音乐合在一页
 */
const SCOPE_SLOT = createSnapshotSlot<{
  readonly category: OnlineCategory;
  readonly scopes: Scopes;
}>();

export function SearchPage({ place }: PageProps) {
  const search = useService(searchKey);
  const store = useStore();
  const albumDetail = useService(albumDetailKey);
  const ratings = useService(ratingsKey);
  const text = place.subject ?? '';
  const [owned, setOwned] = useState<{
    text: string;
    results: SearchResultsService;
    menu: SearchMenuService;
    online: OnlineSearch;
    tracks: SearchTracksService;
  } | null>(null);
  useEffect(() => {
    const results = search.createResults();
    results.setText(text, true);
    const menu = startSearchMenu(store, results, {
      findAlbum: albumDetail.findAlbum,
      stamp: () => ratings.stamp(),
    });
    // 在线结果切到在线音乐范围才取；同一查询词的结果由搜索服务留着，回到这页不重搜
    const online = search.online(text);
    const tracks = startSearchTracks(store, text);
    setOwned({ text, results, menu, online, tracks });
    return () => {
      tracks.dispose();
      menu.dispose();
      results.dispose();
    };
  }, [search, text, store, albumDetail, ratings]);
  return owned?.text === text ? (
    <SearchPageContent
      text={text}
      results={owned.results}
      menu={owned.menu}
      online={owned.online}
      tracks={owned.tracks}
    />
  ) : (
    <Spinner size="small" />
  );
}

function SearchPageContent({
  text,
  results,
  menu,
  online,
  tracks,
}: {
  readonly text: string;
  readonly results: SearchResultsService;
  readonly menu: SearchMenuService;
  readonly online: OnlineSearch;
  readonly tracks: SearchTracksService;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const search = useService(searchKey);
  const store = useStore();
  const request = useAtomValueRawSync(search.request);
  const included = useAtomValueRawSync(SEARCH_ONLINE.atom);
  const platform = useAtomValueRawSync(online.platform);
  const catalog = useAtomValueRawSync(albumsAtom);
  const state = useAtomValueRawSync(results.state);
  const albums = useAtomValueRawSync(results.albums);
  const artists = useAtomValueRawSync(results.artists);
  const onlineTotals = {
    artists: useAtomValueRawSync(online.kinds.artist).total,
    albums: useAtomValueRawSync(online.kinds.album).total,
    tracks: useAtomValueRawSync(online.kinds.track).total,
  };
  // 后退回来时直接以记下的分类与范围开始：先挂上「全部」再换过去，结果区会误播一次切换分类的上滑
  const entry = useContext(PageEntryContext);
  const [saved] = useState(() => (entry ? SCOPE_SLOT.values.get(entry) : undefined));
  const [category, setCategory] = useState<OnlineCategory>(() => {
    if (saved) return saved.category;
    const asked = store.get(search.request);
    return asked?.text === text ? asked.category : 'all';
  });
  const [scopes, setScopes] = useState<Scopes>(saved?.scopes ?? {});
  // 换 key 重挂在线结果，让它按进来时带的曲目定位
  const [onlineEntry, setOnlineEntry] = useState<{ readonly key: number; readonly focus?: string }>(
    { key: 0 },
  );
  usePageSnapshot(
    SCOPE_SLOT,
    {
      capture: () => ({ category, scopes }),
      restore: (snapshot) => {
        setCategory(snapshot.category);
        setScopes(snapshot.scopes);
      },
    },
    true,
  );
  // 切到媒体库范围时在线范围卸载，现场记在这里；指定了分类的进入不沿用它
  const onlineResume = useRef<OnlineResume | null>(null);
  // 直接点页签落在媒体库；歌单只有在线音乐。从在线一区或下拉的链接进来时带上在线音乐
  const chooseCategory = useCallback((next: OnlineCategory, scope: Scope = 'library') => {
    setCategory(next);
    if (next !== 'playlists')
      setScopes((last) => (last[next] === scope ? last : { ...last, [next]: scope }));
  }, []);
  const toLibrary = useCallback(
    (next: SearchCategory) => chooseCategory(next, 'library'),
    [chooseCategory],
  );
  const toOnline = useCallback(
    (next: OnlineCategory) => chooseCategory(next, 'online'),
    [chooseCategory],
  );
  const merged = category === 'all' && included;
  const scope: Scope =
    category === 'playlists' ? 'online' : merged ? 'library' : (scopes[category] ?? 'library');
  const chooseScope = (next: Scope) => {
    if (next === scope || category === 'playlists') return;
    menu.close();
    setScopes((last) => ({ ...last, [category]: next }));
  };
  // 下拉里的「查看 N 张」、播放来源「在线搜索」：页面已开着同一查询词时也要切过去；取走后清掉，返回时不再生效
  useLayoutEffect(() => {
    if (request?.text !== text) return;
    store.set(search.request, null);
    menu.close();
    chooseCategory(request.category, request.scope);
    if (request.scope === 'online') {
      onlineResume.current = null;
      setOnlineEntry((last) => ({ key: last.key + 1, focus: request.focus }));
    }
  }, [request, text, store, search, menu, chooseCategory]);

  const known = catalog.status === 'ready' && !catalog.truncated;
  const [libraryCount, onlineCount] =
    category === 'artists'
      ? [known ? artists.length : null, onlineTotals.artists]
      : category === 'albums'
        ? [known ? albums.length : null, onlineTotals.albums]
        : category === 'tracks'
          ? [state.total, onlineTotals.tracks]
          : [null, null];
  const range: SearchRange | null =
    merged || category === 'playlists'
      ? null
      : { value: scope, library: libraryCount, online: onlineCount };
  // 歌单只有在线音乐，所选来源搜不了时在哪个范围都标出来；其余分类只在在线音乐范围里标
  const blocked = unavailableCategories(t, platform);
  const unavailable =
    scope === 'online' ? blocked : blocked.playlists ? { playlists: blocked.playlists } : {};
  const renderTabs = (narrow: boolean) => (
    <SearchCategoryTabs
      category={category}
      narrow={narrow}
      unavailable={unavailable}
      onChoose={(next) => chooseCategory(next)}
    />
  );
  return (
    <section className={styles.root} data-page="search" aria-label={t('place.search')}>
      <SearchHeader
        text={text}
        scope={scope}
        results={results}
        range={range}
        onScope={chooseScope}
      />
      {scope === 'online' || category === 'playlists' ? (
        <OnlineResults
          key={onlineEntry.key}
          text={text}
          search={online}
          category={category}
          onCategory={toOnline}
          renderTabs={renderTabs}
          focus={onlineEntry.focus}
          resume={onlineResume}
        />
      ) : (
        <LibraryResults
          text={text}
          results={results}
          menu={menu}
          tracks={tracks}
          category={category}
          onCategory={toLibrary}
          renderTabs={renderTabs}
          renderOnline={
            merged
              ? (scroller) => (
                  <OnlineSection
                    text={text}
                    search={online}
                    localTracks={state.tracks}
                    scroller={scroller}
                    onCategory={toOnline}
                  />
                )
              : undefined
          }
          onSearchOnline={() => chooseScope('online')}
        />
      )}
    </section>
  );
}
