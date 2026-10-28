import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import type { PageProps } from '../../nav/places.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { pageTransition } from '../../motion/pageTransition.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import type { TrackFilter } from '../../track/trackFilter.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import { useSearchSession } from './searchContext.ts';
import { SearchFeedback } from './SearchFeedback.tsx';
import { searchHitKey, type SearchHit } from './searchQuery.ts';
import { SearchResultList } from './SearchResultList.tsx';
import { SearchResultRow } from './SearchResultRow.tsx';
import type { SearchResultsService } from './searchResults.ts';
import { readSearchView, saveSearchView, type SearchView } from './results/searchView.ts';
import { SearchViewSwitch } from './results/SearchViewSwitch.tsx';
import { startSearchMenu, type SearchMenuService } from './menus/searchMenu.ts';
import { SearchResultMenu } from './menus/SearchResultMenu.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import styles from './SearchPage.module.css';
import { useService } from '../../kit/useService.ts';
import { searchKey, type SearchCategory } from './searchServices.ts';
import type { OnlineCategory, OnlineSearch } from './online/onlineSearch.ts';
import { OnlineResults, type OnlineResume } from './online/OnlineResults.tsx';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { ratingsKey } from '../../track/trackRatings.ts';
import { CommandBar, COMMAND_BAR_TIERS, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { useWidthTier } from '../../kit/useWidthTier.ts';
import { useFilterSurface } from '../../track/FilterSurface.tsx';
import { SearchCategoryTabs } from './SearchCategoryTabs.tsx';
import { SearchFieldMenu } from './SearchFieldMenu.tsx';
import { SearchHeader } from './SearchHeader.tsx';
import { SEARCH_SCOPES, type SearchScope } from './searchQuery.ts';
import { startSearchTracks, type SearchTracksService } from './tracks/searchTracks.ts';
import { SearchTracksBar, SearchTracksFilter, SearchTracksTable } from './tracks/SearchTracks.tsx';
import { useSearchTracks } from './tracks/useSearchTracks.ts';

type Category = SearchCategory;
interface SearchPageSnapshot {
  readonly category: Category;
  readonly top: number;
  readonly active: string | null;
  readonly view: SearchView;
  readonly loaded: number;
  readonly field: SearchScope;
  /** 「曲目」一类的筛选与排序 */
  readonly filter: TrackFilter;
  readonly sort: TableSort | null;
}
const SLOT = createSnapshotSlot<SearchPageSnapshot>();
type Scope = 'library' | 'online';
/** 范围单独存：在线音乐范围里没有本地的滚动区，本地那份快照这时不登记 */
const SCOPE_SLOT = createSnapshotSlot<{ readonly scope: Scope }>();
const LIST_CELL = { width: null, height: 56, stretch: true } as const;
const GRID_CELL = { width: 160, height: 208, stretch: true } as const;
const playsOnEnter = (hit: SearchHit) => hit.kind === 'track';

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
  const viewControls = useViewControlStyles();
  const session = useSearchSession();
  const search = useService(searchKey);
  const state = useAtomValueRawSync(results.state);
  const albums = useAtomValueRawSync(results.albums);
  const artists = useAtomValueRawSync(results.artists);
  const best = useAtomValueRawSync(results.best);
  const notice = useAtomValueRawSync(useService(objectOpenerKey).notice);
  const playNotice = useAtomValueRawSync(search.notice);
  const menuFailed = useAtomValueRawSync(menu.notice);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const store = useStore();
  const request = useAtomValueRawSync(search.request);
  const [category, setCategory] = useState<Category>(() => {
    const asked = store.get(search.request);
    return asked?.text === text && asked.scope === 'library' ? asked.category : 'all';
  });
  const [scope, setScope] = useState<Scope>('library');
  const field = useAtomValueRawSync(results.scope);
  const chooseField = (next: SearchScope) => {
    results.setScope(next);
    tracks.setScope(next);
  };
  // 换 key 重挂在线结果，让它落在指定的分类上
  const [onlineEntry, setOnlineEntry] = useState<{
    readonly key: number;
    readonly category: OnlineCategory;
    readonly focus?: string;
  }>({ key: 0, category: 'all' });
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<SearchView>(readSearchView);
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const pending = useRef<SearchPageSnapshot | null>(null);
  const lastCategory = useRef(`${category}:${view}`);
  const ready = state.status !== 'loading' && state.status !== 'idle';
  const artistHits = useMemo<SearchHit[]>(
    () => artists.map((artist) => ({ kind: 'artist', artist })),
    [artists],
  );
  const albumHits = useMemo<SearchHit[]>(
    () => albums.map((album) => ({ kind: 'album', album })),
    [albums],
  );
  const trackHits = useMemo<SearchHit[]>(
    () => state.tracks.map((track) => ({ kind: 'track', track })),
    [state.tracks],
  );
  const tracksModel = useSearchTracks(tracks, scope === 'library' && category === 'tracks');
  const [measure, tier] = useWidthTier<CommandBarTier, HTMLDivElement>(COMMAND_BAR_TIERS);
  // 结果页的筛选只弹出、不嵌入页面，所以没有要记住的固定与展开
  const surface = useFilterSurface({
    docked: false,
    expanded: false,
    narrow: tier === 'narrow',
    onDock: () => {},
    onExpand: () => {},
  });
  const preview = (hits: SearchHit[]) =>
    hits.filter((hit) => !best || searchHitKey(hit) !== searchHitKey(best)).slice(0, 6);
  const albumPreview = preview(albumHits);
  const trackPreview = preview(trackHits);
  usePageSnapshot(
    SCOPE_SLOT,
    { capture: () => ({ scope }), restore: (snapshot) => setScope(snapshot.scope) },
    true,
  );
  usePageSnapshot(
    SLOT,
    {
      capture: () => ({
        category,
        view,
        top: scroller?.scrollTop ?? 0,
        active,
        loaded: state.tracks.length,
        field,
        filter: store.get(tracks.filter.state),
        sort: store.get(tracks.sort),
      }),
      restore: (snapshot) => {
        pending.current = snapshot;
        setCategory(snapshot.category);
        setView(snapshot.view);
        results.setScope(snapshot.field);
        tracks.setScope(snapshot.field);
        tracks.filter.restore(snapshot.filter);
        tracks.setSort(snapshot.sort);
      },
    },
    ready && !!scroller,
  );
  // 排在恢复现场的 effect 之前：同一次提交里恢复会先清掉 pending，排在后面就看不到它，返回时会误播切分类的上滑
  useLayoutEffect(() => {
    if (lastCategory.current === `${category}:${view}` || !scroller) return;
    lastCategory.current = `${category}:${view}`;
    if (pending.current || reduced || document.visibilityState !== 'visible') return;
    const animations = pageTransition('refresh', 'forward', false).enter.map((motion) =>
      scroller.animate(motion.keyframes, motion.options),
    );
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [category, view, scroller, reduced]);
  useLayoutEffect(() => {
    const saved = pending.current;
    if (!saved || saved.category !== category || saved.view !== view || !scroller || !ready) return;
    if (state.loadingMore) return;
    if (
      saved.loaded > state.tracks.length &&
      state.total !== null &&
      state.tracks.length < state.total &&
      !state.moreFailed &&
      !state.limited
    ) {
      void results.more(saved.loaded);
      return;
    }
    pending.current = null;
    setActive(saved.active);
    scroller.scrollTop = saved.top;
    if (saved.active && !session.open) {
      const item = scroller.querySelector<HTMLElement>(
        `[data-search-hit="${CSS.escape(encodeURIComponent(saved.active))}"]`,
      );
      (item ?? scroller.querySelector<HTMLElement>('[data-search-list]') ?? scroller).focus({
        preventScroll: true,
      });
    }
  }, [category, view, scroller, session.open, ready, results, state]);

  const choose = (next: Category) => {
    if (next === category) return;
    menu.close();
    setMenuAt(null);
    setCategory(next);
    setActive(null);
    if (scroller) scroller.scrollTop = 0;
  };
  // 切到媒体库范围时在线范围卸载，现场记在这里；指定了分类的进入不沿用它
  const onlineResume = useRef<OnlineResume | null>(null);
  const openOnline = (next: OnlineCategory, focus?: string) => {
    onlineResume.current = null;
    setOnlineEntry((last) => ({ key: last.key + 1, category: next, focus }));
  };
  const chooseScope = (next: Scope) => {
    if (next === scope) return;
    menu.close();
    setMenuAt(null);
    setScope(next);
  };
  // 下拉里的「查看 N 张」、播放来源「在线搜索」：页面已开着同一查询词时也要切过去；取走后清掉，返回时不再生效
  useLayoutEffect(() => {
    if (request?.text !== text) return;
    store.set(search.request, null);
    chooseScope(request.scope);
    if (request.scope === 'library') choose(request.category);
    else openOnline(request.category, request.focus);
  });
  const activate = useCallback(
    (hit: SearchHit, play = false) => {
      setActive(searchHitKey(hit));
      session.activate(hit, text, play);
    },
    [session, text],
  );
  const openMenu = useCallback(
    (hit: SearchHit, at: TablePoint, selection: readonly SearchHit[] = [hit]) => {
      if (hit.kind === 'artist') return;
      setActive(searchHitKey(hit));
      void menu.open(hit, selection);
      setMenuAt(at);
    },
    [menu],
  );
  const row = (hit: SearchHit, tile = false) => (
    <SearchResultRow
      key={searchHitKey(hit)}
      hit={hit}
      tile={tile}
      onActivate={activate}
      onMenu={openMenu}
    />
  );
  const fieldMenu = (
    <SearchFieldMenu
      scope={field}
      scopes={SEARCH_SCOPES}
      labelled={tier === 'wide'}
      onScope={chooseField}
    />
  );
  return (
    <section className={styles.root} data-page="search" aria-label={t('place.search')}>
      <SearchHeader text={text} scope={scope} results={results} onScope={chooseScope} />
      {scope === 'library' ? (
        <>
          <div ref={measure} className={styles.controls} data-search-controls>
            <SearchCategoryTabs category={category} narrow={tier === 'narrow'} onChoose={choose} />
            <span className={styles.divider} aria-hidden />
            {category === 'tracks' ? (
              <SearchTracksBar
                model={tracksModel}
                surface={surface}
                tier={tier}
                field={fieldMenu}
              />
            ) : (
              <CommandBar
                tier={tier}
                label={t('query.toolbar')}
                find={fieldMenu}
                view={
                  <SearchViewSwitch
                    view={view}
                    onChange={(next) => {
                      menu.close();
                      setMenuAt(null);
                      setView(next);
                      saveSearchView(next);
                    }}
                  />
                }
              />
            )}
          </div>
          {category === 'tracks' && <SearchTracksFilter model={tracksModel} surface={surface} />}
          <div
            ref={setScroller}
            className={styles.scroller}
            tabIndex={-1}
            data-search-scroller
            aria-busy={state.status === 'loading'}
          >
            {category === 'all' ? (
              <div className={styles.overview}>
                {best && (
                  <section>
                    <h2>{t('search.best')}</h2>
                    {row(best)}
                  </section>
                )}
                {albumPreview.length > 0 && (
                  <section>
                    <div className={styles.group}>
                      <h2>{t('search.albums')}</h2>
                      <Button
                        className={viewControls.icon}
                        appearance="subtle"
                        size="small"
                        onClick={() => choose('albums')}
                      >
                        {t('search.viewAll')}
                      </Button>
                    </div>
                    <div className={view === 'grid' ? styles.albums : undefined}>
                      {albumPreview.map((hit) => row(hit, view === 'grid'))}
                    </div>
                  </section>
                )}
                {trackPreview.length > 0 && (
                  <section>
                    <div className={styles.group}>
                      <h2>{t('search.tracks')}</h2>
                      <Button
                        className={viewControls.icon}
                        appearance="subtle"
                        size="small"
                        onClick={() => choose('tracks')}
                      >
                        {t('search.viewAll')}
                      </Button>
                    </div>
                    <div className={view === 'grid' ? styles.albums : undefined}>
                      {trackPreview.map((hit) => row(hit, view === 'grid'))}
                    </div>
                  </section>
                )}
              </div>
            ) : category === 'tracks' ? (
              <SearchTracksTable
                model={tracksModel}
                scroller={scroller}
                label={t('search.tracks')}
                empty={
                  <SearchFeedback results={results} onSearchOnline={() => chooseScope('online')} />
                }
              />
            ) : (
              <SearchResultList
                key={category}
                items={
                  category === 'artists'
                    ? artistHits
                    : category === 'albums'
                      ? albumHits
                      : trackHits
                }
                keyOf={searchHitKey}
                cell={view === 'grid' ? GRID_CELL : LIST_CELL}
                playsOnEnter={playsOnEnter}
                renderItem={(hit, props) => (
                  <SearchResultRow hit={hit} option tile={view === 'grid'} {...props} />
                )}
                label={t(`search.${category}`)}
                scroller={scroller}
                active={active}
                onActive={setActive}
                onActivate={activate}
                view={view}
                onMenu={openMenu}
                onAll={async () => (category === 'artists' ? artistHits : albumHits)}
              />
            )}
            {category !== 'tracks' && (
              <SearchFeedback results={results} onSearchOnline={() => chooseScope('online')} />
            )}
            {menuFailed && (
              <div role="status" className={styles.notice}>
                {t('album.commandFailed')}
              </div>
            )}
            {(notice || playNotice) && (
              <div role="status" className={styles.notice}>
                {t(notice ?? playNotice ?? 'album.playFailed')}
              </div>
            )}
          </div>
        </>
      ) : (
        <OnlineResults
          key={onlineEntry.key}
          text={text}
          search={online}
          initial={onlineEntry.category}
          focus={onlineEntry.focus}
          resume={onlineResume}
        />
      )}
      <SearchResultMenu menu={menu} at={menuAt} text={text} onClose={() => setMenuAt(null)} />
    </section>
  );
}
