import { Button, Spinner } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Checkmark20Regular, Edit20Regular } from '@fluentui/react-icons';
import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import type { Album } from '../../host/libraryContract.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { focusLost } from '../../kit/focusLost.ts';
import { useService } from '../../kit/useService.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { AddFoldersAction } from '../AddFoldersAction.tsx';
import { albumListKey } from '../album-list/albumList.ts';
import { AlbumMenu } from '../AlbumMenu.tsx';
import { albumsAtom } from '../albums.ts';
import { albumsKey } from '../albumServices.ts';
import { libraryTracksAtom } from '../libraryTracks.ts';
import { TrackMenu } from '../TrackMenu.tsx';
import { HomeAdded } from './HomeAdded.tsx';
import { HomeBanners } from './HomeBanners.tsx';
import { HomeCharts } from './HomeCharts.tsx';
import { HomeChannels } from './HomeChannels.tsx';
import { HomeContext, useHomeServices } from './homeContext.ts';
import { HomeGems } from './HomeGems.tsx';
import { HomeLayoutEditor } from './HomeLayoutEditor.tsx';
import { HOME_TRACK_COUNT } from './homeModel.ts';
import { HomeMostPlayed } from './HomeMostPlayed.tsx';
import { HomeNcmSetup } from './HomeNcmSetup.tsx';
import { HomeNewTracks } from './HomeNewTracks.tsx';
import { HomePlaylists, HomeReleases } from './HomeOnlineTiles.tsx';
import { HomeOverview } from './HomeOverview.tsx';
import { HomeQuick } from './HomeQuick.tsx';
import { railIndex, scrollRailTo } from './HomeRail.tsx';
import {
  anyHomeSectionShown,
  HOME_ONLINE_SECTIONS,
  HOME_STATISTICS_SECTIONS,
  homeHiddenSectionsAtom,
  homeLayoutAtom,
  type HomeSection,
} from './homeSections.ts';
import { useHomeOnlineRows } from './useHomeOnlineRows.ts';
import styles from './HomePage.module.css';

interface HomeSnapshot {
  /** 重听遗珠换到了第几首起的一批 */
  readonly offset: number;
  readonly scroll: number;
  /** 各横排行翻到了第几张，按行的名字记 */
  readonly rails: Readonly<Record<string, number>>;
  readonly focus: {
    readonly section: string;
    readonly item?: string;
    readonly index: number;
  } | null;
}
const HOME_SLOT = createSnapshotSlot<HomeSnapshot>();

const controlsIn = (element: HTMLElement | null | undefined) => [
  ...(element?.querySelectorAll<HTMLElement>('button, select') ?? []),
];
const railsIn = (element: HTMLElement | null) => [
  ...(element?.querySelectorAll<HTMLElement>('[data-home-rail]') ?? []),
];

export function HomePage() {
  const home = useContext(HomeContext);
  return home ? <HomeContent /> : null;
}

/**
 * 各行同宽，量一次页头的宽度交给各行算版式。挂载时先同步读一次：回到这一页时滚动位置要落在排好的版式上，
 * 不能等观察器的第一次回调
 */
function useRowWidth(target: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      // 观察器在排版后、绘制前回调；走常规调度会晚一帧，拖动窗口时各行落后于窗口
      if (entry) flushSync(() => setWidth(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return width;
}

function HomeContent() {
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const t = useAtomValueRawSync(translateAtom);
  const albums = useService(albumsKey);
  const albumList = useService(albumListKey);
  const store = useStore();
  const catalog = useAtomValueRawSync(albumsAtom);
  const feed = useAtomValueRawSync(home.feed.state);
  const recent = useAtomValueRawSync(home.recent.state);
  const overview = useAtomValueRawSync(home.overview.state);
  const notice = useAtomValueRawSync(home.notice);
  const root = useRef<HTMLElement>(null);
  const head = useRef<HTMLElement>(null);
  const waiting = useRef<HomeSnapshot | null>(null);
  const rowWidth = useRowWidth(head);
  const online = useHomeOnlineRows();
  const hidden = useAtomValueRawSync(homeHiddenSectionsAtom);
  const layout = useAtomValueRawSync(homeLayoutAtom);
  const statistics = anyHomeSectionShown(hidden, HOME_STATISTICS_SECTIONS);
  const added = !hidden.includes('added');
  const overviewShown = !hidden.includes('overview');
  const [editing, setEditing] = useState(false);
  useCommand({
    id: 'home.edit.done',
    layer: 'overlay',
    keys: [{ key: 'Escape' }],
    enabled: () => editing,
    run: () => setEditing(false),
  });
  const [now] = useState(() => Date.now());
  const [view, setView] = useState({ offset: 0 });
  const [albumMenu, setAlbumMenu] = useState<{ at: TablePoint; owner: string } | null>(null);
  const [trackMenu, setTrackMenu] = useState<TablePoint | null>(null);
  // 在设置里关掉的行不读它的数据
  useEffect(() => {
    if (statistics) home.feed.activate();
    if (added) home.recent.activate();
    if (overviewShown) home.overview.activate();
    home.online.activate();
  }, [home, statistics, added, overviewShown]);
  const captureFocus = (): HomeSnapshot['focus'] => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.current?.contains(active)) return null;
    const section = active.closest<HTMLElement>('[data-home-section]') ?? root.current;
    const item = active.closest<HTMLElement>('[data-home-item]');
    return {
      section: section.dataset.homeSection ?? '',
      item: item?.dataset.homeItem,
      index: controlsIn(item ?? section).indexOf(active),
    };
  };
  usePageSnapshot(
    HOME_SLOT,
    {
      capture: () =>
        waiting.current ?? {
          offset: view.offset,
          scroll: root.current?.scrollTop ?? 0,
          rails: Object.fromEntries(
            railsIn(root.current).map((rail) => [rail.dataset.homeRail ?? '', railIndex(rail)]),
          ),
          focus: captureFocus(),
        },
      restore(snapshot) {
        waiting.current = snapshot;
        setView({ offset: snapshot.offset });
      },
    },
    catalog.status === 'ready',
  );
  useLayoutEffect(() => {
    const saved = waiting.current;
    if (!saved || saved.offset !== view.offset || !root.current || rowWidth <= 0) return;
    waiting.current = null;
    for (const rail of railsIn(root.current))
      scrollRailTo(rail, saved.rails[rail.dataset.homeRail ?? ''] ?? 0);
    root.current.scrollTop = saved.scroll;
    if (focusLost() && saved.focus) {
      const { section, item, index } = saved.focus;
      const group = section
        ? [...root.current.querySelectorAll<HTMLElement>('[data-home-section]')].find(
            (node) => node.dataset.homeSection === section,
          )
        : root.current;
      const container = item
        ? [...(group?.querySelectorAll<HTMLElement>('[data-home-item]') ?? [])].find(
            (node) => node.dataset.homeItem === item,
          )
        : group;
      controlsIn(container)[index]?.focus({ preventScroll: true });
    }
  }, [view, rowWidth]);

  const forgotten = feed.statistics.forgotten;
  useLayoutEffect(() => {
    if (feed.status === 'ready' && view.offset > 0 && view.offset >= forgotten.length)
      setView({ offset: 0 });
  }, [feed.status, forgotten.length, view.offset]);
  const openAlbumMenu = (album: Album, at: TablePoint, owner: string) => {
    setTrackMenu(null);
    void albums.menu.prepare([album]);
    setAlbumMenu({ at, owner });
  };
  const openTrackMenu = (track: LibraryTrack, at: TablePoint) => {
    setAlbumMenu(null);
    void albumList.menu.prepare([track], track, store.get(libraryTracksAtom).stamp);
    setTrackMenu(at);
  };
  const refresh = () => {
    void albums.browse.retry();
    if (statistics) void home.feed.refresh();
    if (added) void home.recent.refresh();
    if (overviewShown) void home.overview.refresh();
  };
  const retry = (
    <Button className={viewControls.field} onClick={refresh}>
      {t('album.retry')}
    </Button>
  );
  const statsFailed = feed.status === 'failed' || feed.status === 'unavailable';
  // 各行的元素先备好，按设置里的次序放；元素不渲染就不取数，关掉的行只是不放
  const rows: Record<HomeSection, ReactNode> = {
    quick: <HomeQuick rowWidth={rowWidth} now={now} onMenu={openAlbumMenu} />,
    banners: <HomeBanners rowWidth={rowWidth} />,
    added: <HomeAdded rowWidth={rowWidth} onMenu={openAlbumMenu} menuOwner={albumMenu?.owner} />,
    'new-tracks': (
      <HomeNewTracks
        rowWidth={rowWidth}
        tracks={online.newTracks}
        loading={online.newTracksLoading}
      />
    ),
    charts: (
      <HomeCharts rowWidth={rowWidth} charts={online.charts} loading={online.chartsLoading} />
    ),
    playlists: <HomePlaylists rowWidth={rowWidth} />,
    gems: (
      <HomeGems
        rowWidth={rowWidth}
        now={now}
        offset={view.offset}
        onNext={() =>
          setView(({ offset }) => {
            const next = offset + HOME_TRACK_COUNT;
            return { offset: next < forgotten.length ? next : 0 };
          })
        }
        onMenu={(item, at) => openTrackMenu(item.track, at)}
      />
    ),
    releases: <HomeReleases rowWidth={rowWidth} />,
    'most-played': (
      <HomeMostPlayed rowWidth={rowWidth} onAlbumMenu={openAlbumMenu} onTrackMenu={openTrackMenu} />
    ),
    overview: <HomeOverview rowWidth={rowWidth} />,
  };
  return (
    <section
      ref={root}
      className={styles.root}
      data-page="home"
      aria-label={t('place.home')}
      data-page-scrolls-header
    >
      <header ref={head} className={styles.header}>
        <h1>{t('place.home')}</h1>
        {editing ? (
          <Button
            appearance="primary"
            icon={<Checkmark20Regular />}
            onClick={() => setEditing(false)}
          >
            {t('home.done')}
          </Button>
        ) : (
          <Button
            className={viewControls.field}
            icon={<Edit20Regular />}
            onClick={() => setEditing(true)}
          >
            {t('home.edit')}
          </Button>
        )}
      </header>
      {notice && <p role="alert">{t(notice)}</p>}
      {catalog.status === 'failed' && (
        <p role="alert">
          {t('album.readFailed')} {retry}
        </p>
      )}
      {catalog.status === 'ready' && !catalog.enabled && <p>{t('album.disabledTitle')}</p>}
      {catalog.status === 'ready' && catalog.enabled && !catalog.albums.length && (
        <p>{t('album.empty')}</p>
      )}
      <AddFoldersAction />
      {catalog.truncated && <p>{t('album.truncated', { count: catalog.albums.length })}</p>}
      {catalog.status === 'loading' && <Spinner size="tiny" label={t('album.loading')} />}
      {(feed.dirty || recent.dirty || overview.dirty) && (
        <div className={styles.changed}>
          <span role="status">{t('home.changed')}</span>
          <Button
            className={viewControls.field}
            icon={<ArrowClockwise20Regular />}
            onClick={refresh}
          >
            {t('home.refresh')}
          </Button>
        </div>
      )}
      {editing ? (
        <HomeLayoutEditor scroller={root} />
      ) : (
        <>
          {anyHomeSectionShown(hidden, HOME_ONLINE_SECTIONS) && <HomeNcmSetup />}
          {rowWidth > 0 && (
            <>
              {statistics && feed.available !== false && (statsFailed || feed.unreadCount > 0) && (
                <p role={statsFailed ? 'alert' : 'status'} data-home-section="statistics">
                  {statsFailed
                    ? t(
                        feed.failure === 'components'
                          ? 'home.statsProbeFailed'
                          : feed.failure === 'library'
                            ? 'home.statsLibraryFailed'
                            : feed.failure === 'albums'
                              ? 'album.readFailed'
                              : 'home.statsFailed',
                      )
                    : t('home.statsPartial', { count: feed.unreadCount })}{' '}
                  {retry}
                </p>
              )}
              {layout.map(({ id, shown }) => shown && <Fragment key={id}>{rows[id]}</Fragment>)}
            </>
          )}
          <HomeChannels />
        </>
      )}
      <AlbumMenu at={albumMenu?.at ?? null} onClose={() => setAlbumMenu(null)} />
      <TrackMenu at={trackMenu} onClose={() => setTrackMenu(null)} />
    </section>
  );
}
