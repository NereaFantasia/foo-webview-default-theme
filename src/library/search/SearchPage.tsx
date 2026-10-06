import { Button, Spinner, Tab, TabList, Tooltip } from '@fluentui/react-components';
import { Edit20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import type { PageProps } from '../../nav/places.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { pageTransition } from '../../motion/pageTransition.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { albumDetailNoticeAtom } from '../album-detail/albumDetailOpen.ts';
import { albumsAtom } from '../albums.ts';
import { useSearchSession } from './searchContext.ts';
import { SearchFeedback } from './SearchFeedback.tsx';
import { searchHitKey, type SearchHit } from './searchQuery.ts';
import { SearchResultList } from './SearchResultList.tsx';
import { SearchResultRow } from './SearchResultRow.tsx';
import type { SearchResultsService } from './searchResults.ts';
import { readSearchView, saveSearchView, type SearchView } from './results/searchView.ts';
import { useSearchMore } from './results/useSearchMore.ts';
import { SearchViewSwitch } from './results/SearchViewSwitch.tsx';
import { startSearchMenu, type SearchMenuService } from './menus/searchMenu.ts';
import { SearchResultMenu } from './menus/SearchResultMenu.tsx';
import styles from './SearchPage.module.css';
import { useService } from '../../kit/useService.ts';
import { searchKey } from './searchServices.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { ratingsKey } from '../../track/trackRatings.ts';

type Category = 'all' | 'albums' | 'tracks';
interface SearchPageSnapshot {
  readonly category: Category;
  readonly top: number;
  readonly active: string | null;
  readonly view: SearchView;
  readonly loaded: number;
}
const SLOT = createSnapshotSlot<SearchPageSnapshot>();

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
  } | null>(null);
  useEffect(() => {
    const results = search.createResults();
    results.setText(text, true);
    const menu = startSearchMenu(store, results, {
      findAlbum: albumDetail.findAlbum,
      stamp: () => ratings.stamp(),
    });
    setOwned({ text, results, menu });
    return () => {
      menu.dispose();
      results.dispose();
    };
  }, [search, text, store, albumDetail, ratings]);
  return owned?.text === text ? (
    <SearchPageContent text={text} results={owned.results} menu={owned.menu} />
  ) : (
    <Spinner size="small" />
  );
}

function SearchPageContent({
  text,
  results,
  menu,
}: {
  readonly text: string;
  readonly results: SearchResultsService;
  readonly menu: SearchMenuService;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const session = useSearchSession();
  const search = useService(searchKey);
  const state = useAtomValueRawSync(results.state);
  const albums = useAtomValueRawSync(results.albums);
  const best = useAtomValueRawSync(results.best);
  const catalog = useAtomValueRawSync(albumsAtom);
  const notice = useAtomValueRawSync(albumDetailNoticeAtom);
  const playNotice = useAtomValueRawSync(search.notice);
  const menuFailed = useAtomValueRawSync(menu.notice);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [category, setCategory] = useState<Category>('all');
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<SearchView>(readSearchView);
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const pending = useRef<SearchPageSnapshot | null>(null);
  const lastCategory = useRef(`${category}:${view}`);
  const ready = state.status !== 'loading' && state.status !== 'idle';
  const albumHits = useMemo<SearchHit[]>(
    () => albums.map((album) => ({ kind: 'album', album })),
    [albums],
  );
  const trackHits = useMemo<SearchHit[]>(
    () => state.tracks.map((track) => ({ kind: 'track', track })),
    [state.tracks],
  );
  const more = useSearchMore(results, scroller, category === 'tracks' && !pending.current);
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
      }),
      restore: (snapshot) => {
        pending.current = snapshot;
        setCategory(snapshot.category);
        setView(snapshot.view);
      },
    },
    ready && !!scroller,
  );
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

  const choose = (next: Category) => {
    if (next === category) return;
    menu.close();
    setMenuAt(null);
    setCategory(next);
    setActive(null);
    if (scroller) scroller.scrollTop = 0;
  };
  const activate = useCallback(
    (hit: SearchHit, play = false) => {
      setActive(searchHitKey(hit));
      session.activate(hit, text, play);
    },
    [session, text],
  );
  const openMenu = useCallback(
    (hit: SearchHit, at: TablePoint, selection: readonly SearchHit[] = [hit]) => {
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
  const hasMore =
    state.status === 'ready' &&
    state.total !== null &&
    state.tracks.length < state.total &&
    !state.limited;
  return (
    <section className={styles.root} data-page="search" aria-label={t('place.search')}>
      <header className={styles.header}>
        <div className={styles.title}>
          <h1 title={text}>{text}</h1>
          <div className={styles.count}>
            {t('search.count', {
              albums:
                catalog.status === 'ready' && !catalog.truncated
                  ? albums.length
                  : t('search.unknownCount'),
              tracks: state.total ?? t('search.unknownCount'),
            })}
          </div>
        </div>
        <Tooltip content={t('search.edit')} relationship="label">
          <Button
            appearance="subtle"
            icon={<Edit20Regular />}
            aria-label={t('search.edit')}
            onClick={() => session.show(text)}
          />
        </Tooltip>
      </header>
      <div className={styles.controls}>
        <TabList
          selectedValue={category}
          onTabSelect={(_, data) => {
            if (data.value === 'all' || data.value === 'albums' || data.value === 'tracks')
              choose(data.value);
          }}
          aria-label={t('place.search')}
        >
          <Tab value="all">{t('search.all')}</Tab>
          <Tab value="albums">{t('search.albums')}</Tab>
          <Tab value="tracks">{t('search.tracks')}</Tab>
        </TabList>
        <SearchViewSwitch
          view={view}
          onChange={(next) => {
            menu.close();
            setMenuAt(null);
            setView(next);
            saveSearchView(next);
          }}
        />
      </div>
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
                  <Button appearance="subtle" size="small" onClick={() => choose('albums')}>
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
                  <Button appearance="subtle" size="small" onClick={() => choose('tracks')}>
                    {t('search.viewAll')}
                  </Button>
                </div>
                <div className={view === 'grid' ? styles.albums : undefined}>
                  {trackPreview.map((hit) => row(hit, view === 'grid'))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <SearchResultList
            key={category}
            hits={category === 'albums' ? albumHits : trackHits}
            label={t(`search.${category}`)}
            scroller={scroller}
            active={active}
            onActive={setActive}
            onActivate={activate}
            view={view}
            onMenu={openMenu}
            onAll={async () => {
              if (category === 'albums') return albumHits;
              const tracks = await results.all();
              return tracks?.map((track): SearchHit => ({ kind: 'track', track })) ?? null;
            }}
          />
        )}
        <SearchFeedback results={results} />
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
        {category === 'tracks' && hasMore && (
          <div ref={more} className={styles.more} data-search-more>
            <Button disabled={state.loadingMore} onClick={() => void results.more()}>
              {t(
                state.moreFailed
                  ? 'album.retry'
                  : state.loadingMore
                    ? 'album.loading'
                    : 'search.more',
              )}
            </Button>
          </div>
        )}
      </div>
      <SearchResultMenu menu={menu} at={menuAt} text={text} onClose={() => setMenuAt(null)} />
    </section>
  );
}
