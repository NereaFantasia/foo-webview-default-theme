import { Button, Select, Spinner, Tab, TabList, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise20Regular, ArrowShuffle20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { focusLost } from '../../kit/focusLost.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import type { TablePoint } from '../../table/tableItems.ts';
import { AlbumMenu } from '../AlbumMenu.tsx';
import { albumsAtom } from '../albums.ts';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import { libraryTracksAtom } from '../libraryTracks.ts';
import { TrackMenu } from '../TrackMenu.tsx';
import { HomeAlbumCard } from './HomeAlbumCard.tsx';
import { HomeChannels } from './HomeChannels.tsx';
import { HomePins } from './HomePins.tsx';
import { HOME_RECENT_LIMIT } from './homeRecent.ts';
import { HomeContext, useHomeServices } from './homeContext.ts';
import {
  HOME_TRACK_COUNT,
  sampleHomeAlbums,
  type HomeDuration,
  type HomeGemMode,
  type HomeMode,
} from './homeModel.ts';
import { HomeTrackRow } from './HomeTrackRow.tsx';
import styles from './HomePage.module.css';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { AddFoldersAction } from '../AddFoldersAction.tsx';

interface HomeView {
  readonly mode: HomeMode;
  readonly gem: HomeGemMode;
  readonly duration: HomeDuration;
  readonly albums: readonly Album[];
  readonly offset: number;
}
interface HomeSnapshot {
  readonly view: HomeView;
  readonly scroll: number;
  readonly focus: {
    readonly section: string;
    readonly item?: string;
    readonly index: number;
  } | null;
}
const HOME_SLOT = createSnapshotSlot<HomeSnapshot>();

export function HomePage() {
  const home = useContext(HomeContext);
  return home ? <HomeContent /> : null;
}

function HomeContent() {
  const home = useHomeServices();
  const t = useAtomValueRawSync(translateAtom);
  const albums = useService(albumsKey);
  const albumList = useService(albumListKey);
  const store = useStore();
  const catalog = useAtomValueRawSync(albumsAtom);
  const feed = useAtomValueRawSync(home.feed.state);
  const recent = useAtomValueRawSync(home.recent.state);
  const added = useAtomValueRawSync(home.recent.albums);
  const busy = useAtomValueRawSync(home.busy);
  const notice = useAtomValueRawSync(home.notice);
  const root = useRef<HTMLElement>(null);
  const waiting = useRef<HomeSnapshot | null>(null);
  const initialized = useRef(catalog.status === 'ready');
  const [view, setView] = useState<HomeView>(() => ({
    mode: 'albums',
    gem: 'forgotten',
    duration: 0,
    albums: sampleHomeAlbums(catalog.albums, 0),
    offset: 0,
  }));
  const [albumMenu, setAlbumMenu] = useState<{ at: TablePoint; owner: string } | null>(null);
  const [trackMenu, setTrackMenu] = useState<TablePoint | null>(null);
  useEffect(() => {
    home.feed.activate();
    home.recent.activate();
  }, [home]);
  useLayoutEffect(() => {
    if (catalog.status !== 'ready' || initialized.current) return;
    initialized.current = true;
    setView((old) => ({ ...old, albums: sampleHomeAlbums(catalog.albums, old.duration) }));
  }, [catalog]);
  const controls = (element: HTMLElement | null | undefined) => [
    ...(element?.querySelectorAll<HTMLElement>('button, select') ?? []),
  ];
  const captureFocus = (): HomeSnapshot['focus'] => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.current?.contains(active)) return null;
    const section = active.closest<HTMLElement>('[data-home-section]') ?? root.current;
    const item = active.closest<HTMLElement>('[data-home-item]');
    return {
      section: section.dataset.homeSection ?? '',
      item: item?.dataset.homeItem,
      index: controls(item ?? section).indexOf(active),
    };
  };
  usePageSnapshot(
    HOME_SLOT,
    {
      capture: () =>
        waiting.current ?? {
          view,
          scroll: root.current?.scrollTop ?? 0,
          focus: captureFocus(),
        },
      restore(snapshot) {
        initialized.current = true;
        const restored = { ...snapshot.view };
        waiting.current = { ...snapshot, view: restored };
        setView(restored);
      },
    },
    catalog.status === 'ready',
  );
  useLayoutEffect(() => {
    const saved = waiting.current;
    if (!saved || saved.view !== view || !root.current) return;
    waiting.current = null;
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
      controls(container)[index]?.focus({ preventScroll: true });
    }
  }, [view]);

  const menu = (album: Album, at: TablePoint, owner: string) => {
    setTrackMenu(null);
    void albums.menu.prepare([album]);
    setAlbumMenu({ at, owner });
  };
  const albumGrid = (items: readonly Album[], compact = false) => (
    <div className={compact ? styles.candidates : styles.grid}>
      {items.map((album) => (
        <HomeAlbumCard
          key={albumKeyOf(album)}
          album={album}
          onMenu={menu}
          menuOwner={albumMenu?.owner}
          compact={compact}
        />
      ))}
    </div>
  );
  const candidates =
    view.gem === 'forgotten' ? feed.statistics.forgotten : feed.statistics.unplayed;
  useLayoutEffect(() => {
    if (feed.status === 'ready' && view.offset > 0 && view.offset >= candidates.length)
      setView((old) => ({ ...old, offset: 0 }));
  }, [feed.status, candidates.length, view.offset]);
  const gems = candidates.slice(view.offset, view.offset + HOME_TRACK_COUNT);
  const refresh = () => {
    void albums.browse.retry();
    void home.feed.refresh();
    void home.recent.refresh();
  };
  return (
    <section ref={root} className={styles.root} data-page="home" aria-label={t('place.home')}>
      <header className={styles.header}>
        <h1>{t('place.home')}</h1>
        <PrimaryPlayButton
          icon={<ArrowShuffle20Regular />}
          disabled={busy || !catalog.enabled}
          onClick={() => void home.shuffle()}
        >
          {t('home.shuffle')}
        </PrimaryPlayButton>
      </header>
      {notice && <p role="alert">{t(notice)}</p>}
      {catalog.status === 'failed' && (
        <p role="alert">
          {t('album.readFailed')} <Button onClick={refresh}>{t('album.retry')}</Button>
        </p>
      )}
      {catalog.status === 'ready' && !catalog.enabled && <p>{t('album.disabledTitle')}</p>}
      {catalog.status === 'ready' && catalog.enabled && !catalog.albums.length && (
        <p>{t('album.empty')}</p>
      )}
      <AddFoldersAction />
      {catalog.truncated && <p>{t('album.truncated', { count: catalog.albums.length })}</p>}
      {catalog.status === 'loading' && <Spinner size="tiny" label={t('album.loading')} />}
      <HomePins />
      {(feed.dirty || recent.dirty) && (
        <div className={styles.header}>
          <span role="status">{t('home.changed')}</span>
          <Button icon={<ArrowClockwise20Regular />} onClick={refresh}>
            {t('home.refresh')}
          </Button>
        </div>
      )}
      {feed.available !== false &&
        (feed.status !== 'ready' || feed.statistics.recent.length > 0) && (
          <section aria-label={t('home.recent')} data-home-section="recent">
            <h2>{t('home.recent')}</h2>
            {albumGrid(feed.statistics.recent)}
            {(feed.status === 'idle' || feed.status === 'loading') && (
              <Spinner size="tiny" label={t('home.statsLoading')} />
            )}
            {(feed.status === 'failed' || feed.status === 'unavailable') && (
              <p role="alert">
                {t('home.statsFailed')}{' '}
                <Button onClick={() => void home.feed.refresh()}>{t('album.retry')}</Button>
              </p>
            )}
          </section>
        )}
      {feed.available === false && <p role="status">{t('home.statsMissing')}</p>}
      <section aria-label={t('home.added')} data-home-section="added">
        <header className={styles.header}>
          <h2>{t('home.added')}</h2>
          <Tooltip content={t('home.refreshAdded')} relationship="label">
            <Button
              icon={<ArrowClockwise20Regular />}
              aria-label={t('home.refreshAdded')}
              onClick={() => {
                void home.recent.refresh();
                void albums.browse.retry();
              }}
            />
          </Tooltip>
        </header>
        {albumGrid(added)}
        {(recent.status === 'idle' || recent.status === 'loading') && (
          <Spinner size="tiny" label={t('home.addedLoading')} />
        )}
        {(recent.status === 'failed' || recent.status === 'unavailable') && (
          <p role="alert">
            {t('home.addedFailed')}{' '}
            <Button onClick={() => void home.recent.refresh()}>{t('album.retry')}</Button>
          </p>
        )}
        {recent.status === 'disabled' && <p>{t('album.disabledTitle')}</p>}
        {(recent.status === 'missing' ||
          (recent.status === 'ready' && catalog.status === 'ready' && !added.length)) && (
          <p>{t('home.noAdded')}</p>
        )}
        {recent.status === 'ready' && recent.limited && added.length < 6 && (
          <p>{t('home.addedLimit', { count: HOME_RECENT_LIMIT })}</p>
        )}
      </section>
      <section aria-label={t('home.explore')} data-home-section="explore">
        <header className={styles.header}>
          <h2>{t('home.explore')}</h2>
          <Tooltip content={t('home.nextBatch')} relationship="label">
            <Button
              icon={<ArrowClockwise20Regular />}
              aria-label={t('home.nextBatch')}
              disabled={view.mode === 'albums' ? !catalog.albums.length : !candidates.length}
              onClick={() =>
                setView((old) =>
                  old.mode === 'albums'
                    ? { ...old, albums: sampleHomeAlbums(catalog.albums, old.duration) }
                    : {
                        ...old,
                        offset:
                          old.offset + HOME_TRACK_COUNT < candidates.length
                            ? old.offset + HOME_TRACK_COUNT
                            : 0,
                      },
                )
              }
            />
          </Tooltip>
        </header>
        <div className={styles.filters}>
          <TabList
            selectedValue={view.mode}
            onTabSelect={(_, data) =>
              setView((old) => ({ ...old, mode: data.value === 'gems' ? 'gems' : 'albums' }))
            }
          >
            <Tab value="albums">{t('home.albums')}</Tab>
            <Tab value="gems" disabled={feed.available !== true}>
              {t('home.gems')}
            </Tab>
          </TabList>
          {view.mode === 'albums' ? (
            <Select
              aria-label={t('home.duration')}
              value={String(view.duration)}
              onChange={(_, data) => {
                const duration: HomeDuration =
                  data.value === '30' ? 30 : data.value === '60' ? 60 : 0;
                setView((old) => ({
                  ...old,
                  duration,
                  albums: sampleHomeAlbums(catalog.albums, duration),
                }));
              }}
            >
              <option value="0">{t('home.anyDuration')}</option>
              <option value="30">{t('home.minutes', { count: 30 })}</option>
              <option value="60">{t('home.minutes', { count: 60 })}</option>
            </Select>
          ) : (
            <Select
              aria-label={t('home.gemCondition')}
              value={view.gem}
              onChange={(_, data) =>
                setView((old) => ({
                  ...old,
                  gem: data.value === 'unplayed' ? 'unplayed' : 'forgotten',
                  offset: 0,
                }))
              }
            >
              <option value="forgotten">{t('home.forgotten')}</option>
              <option value="unplayed">{t('home.unplayed')}</option>
            </Select>
          )}
        </div>
        {view.mode === 'albums' ? (
          <>
            {albumGrid(view.albums, true)}
            {catalog.status === 'ready' && !view.albums.length && <p>{t('home.noAlbums')}</p>}
          </>
        ) : (
          <>
            {gems.map((item) => (
              <HomeTrackRow
                key={item.track.handle}
                item={item}
                mode={view.gem}
                onMenu={(target, at) => {
                  setAlbumMenu(null);
                  void albumList.menu.prepare(
                    [target.track],
                    target.track,
                    store.get(libraryTracksAtom).stamp,
                  );
                  setTrackMenu(at);
                }}
              />
            ))}
            {!gems.length && feed.status === 'ready' && <p>{t('home.noGems')}</p>}
            {!!candidates.length && (
              <Button appearance="subtle" onClick={() => home.openGems(view.gem)}>
                {t('home.viewAll')}
              </Button>
            )}
          </>
        )}
      </section>
      <HomeChannels />
      <AlbumMenu at={albumMenu?.at ?? null} onClose={() => setAlbumMenu(null)} />
      <TrackMenu at={trackMenu} onClose={() => setTrackMenu(null)} />
    </section>
  );
}
