import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { CommandBar, COMMAND_BAR_TIERS, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { useService } from '../../kit/useService.ts';
import { useWidthTier } from '../../kit/useWidthTier.ts';
import { pageTransition } from '../../motion/pageTransition.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { useFilterSurface } from '../../track/FilterSurface.tsx';
import type { TrackFilter } from '../../track/trackFilter.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import type { SearchMenuService } from './menus/searchMenu.ts';
import { SearchResultMenu } from './menus/SearchResultMenu.tsx';
import { readSearchView, saveSearchView, type SearchView } from './results/searchView.ts';
import { SearchViewSwitch } from './results/SearchViewSwitch.tsx';
import { useSearchSession } from './searchContext.ts';
import { SearchFeedback } from './SearchFeedback.tsx';
import { SearchFieldMenu } from './SearchFieldMenu.tsx';
import { searchHitKey, SEARCH_SCOPES, type SearchHit, type SearchScope } from './searchQuery.ts';
import { SearchResultList } from './SearchResultList.tsx';
import { SearchResultRow } from './SearchResultRow.tsx';
import type { SearchResultsService } from './searchResults.ts';
import { searchKey, type SearchCategory } from './searchServices.ts';
import { SearchTracksBar, SearchTracksFilter, SearchTracksTable } from './tracks/SearchTracks.tsx';
import type { SearchTracksService } from './tracks/searchTracks.ts';
import { useSearchTracks } from './tracks/useSearchTracks.ts';
import styles from './LibraryResults.module.css';

interface LibrarySnapshot {
  readonly category: SearchCategory;
  readonly top: number;
  readonly active: string | null;
  readonly view: SearchView;
  readonly loaded: number;
  readonly field: SearchScope;
  /** 「曲目」一类的筛选与排序 */
  readonly filter: TrackFilter;
  readonly sort: TableSort | null;
}
const SLOT = createSnapshotSlot<LibrarySnapshot>();
const LIST_CELL = { width: null, height: 56, stretch: true } as const;
const GRID_CELL = { width: 160, height: 208, stretch: true } as const;
const playsOnEnter = (hit: SearchHit) => hit.kind === 'track';

export interface LibraryResultsProps {
  readonly text: string;
  readonly results: SearchResultsService;
  readonly menu: SearchMenuService;
  readonly tracks: SearchTracksService;
  /** 分类由结果页持有：页面的入口请求与范围切换都要改它 */
  readonly category: SearchCategory;
  onCategory(category: SearchCategory): void;
  /** 分类页签，`narrow` 时收成下拉；页签与在线音乐范围共用一行 */
  renderTabs(narrow: boolean): ReactNode;
  /**
   * 「全部」里接在媒体库总览后面的在线音乐一区，给了就分两区各带区标题。参数是这页的滚动区，一区里的曲目表按它虚拟化
   */
  renderOnline?(scroller: HTMLElement | null): ReactNode;
  /** 媒体库没有匹配时切到在线音乐范围 */
  onSearchOnline(): void;
}

/** 搜索结果页的媒体库范围：分类页签兼作命令栏，下面是「全部」的总览、各类的列表或「曲目」的表格 */
export function LibraryResults({
  text,
  results,
  menu,
  tracks,
  category,
  onCategory,
  renderTabs,
  renderOnline,
  onSearchOnline,
}: LibraryResultsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const session = useSearchSession();
  const search = useService(searchKey);
  const store = useStore();
  const state = useAtomValueRawSync(results.state);
  const albums = useAtomValueRawSync(results.albums);
  const artists = useAtomValueRawSync(results.artists);
  const best = useAtomValueRawSync(results.best);
  const notice = useAtomValueRawSync(useService(objectOpenerKey).notice);
  const playNotice = useAtomValueRawSync(search.notice);
  const menuFailed = useAtomValueRawSync(menu.notice);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const field = useAtomValueRawSync(results.scope);
  const chooseField = (next: SearchScope) => {
    results.setScope(next);
    tracks.setScope(next);
  };
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<SearchView>(readSearchView);
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const pending = useRef<LibrarySnapshot | null>(null);
  const lastCategory = useRef(`${category}:${view}`);
  const shownCategory = useRef(category);
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
  const tracksModel = useSearchTracks(tracks, category === 'tracks');
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
        shownCategory.current = snapshot.category;
        onCategory(snapshot.category);
        setView(snapshot.view);
        results.setScope(snapshot.field);
        tracks.setScope(snapshot.field);
        tracks.filter.restore(snapshot.filter);
        tracks.setSort(snapshot.sort);
      },
    },
    ready && !!scroller,
  );
  // 分类由页面换过来时（入口请求、点页签）关菜单、清选中、回到顶上；后退恢复现场时不清
  useLayoutEffect(() => {
    if (shownCategory.current === category) return;
    shownCategory.current = category;
    menu.close();
    setMenuAt(null);
    setActive(null);
    if (scroller) scroller.scrollTop = 0;
  }, [category, menu, scroller]);
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
  const notices = (
    <>
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
    </>
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
    <>
      <div ref={measure} className={styles.controls} data-search-controls>
        {renderTabs(tier === 'narrow')}
        <span className={styles.divider} aria-hidden />
        {category === 'tracks' ? (
          <SearchTracksBar model={tracksModel} surface={surface} tier={tier} field={fieldMenu} />
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
          <>
            {renderOnline && <h2 className={styles.section}>{t('online.scopeLibrary')}</h2>}
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
                      onClick={() => onCategory('albums')}
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
                      onClick={() => onCategory('tracks')}
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
            {/* 合在一页时在线音乐一区就在下面，没有匹配时不再给「在线音乐里搜索」 */}
            <SearchFeedback
              results={results}
              onSearchOnline={renderOnline ? undefined : onSearchOnline}
            />
            {notices}
            {renderOnline?.(scroller)}
          </>
        ) : category === 'tracks' ? (
          <SearchTracksTable
            model={tracksModel}
            scroller={scroller}
            label={t('search.tracks')}
            empty={<SearchFeedback results={results} onSearchOnline={onSearchOnline} />}
          />
        ) : (
          <SearchResultList
            key={category}
            items={category === 'artists' ? artistHits : albumHits}
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
        {(category === 'artists' || category === 'albums') && (
          <SearchFeedback results={results} onSearchOnline={onSearchOnline} />
        )}
        {category !== 'all' && notices}
      </div>
      <SearchResultMenu menu={menu} at={menuAt} text={text} onClose={() => setMenuAt(null)} />
    </>
  );
}
