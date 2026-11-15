import { Spinner } from '@fluentui/react-components';
import { Heart48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { COMMAND_BAR_TIERS, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { useService } from '../../kit/useService.ts';
import { useWidthTier } from '../../kit/useWidthTier.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { onlineFavoritesKey } from '../../playback/onlineFavorites.ts';
import { onlineKey } from '../../playback/onlineTracks.ts';
import { playingOnlineKeyAtom } from '../../playback/playback.ts';
import type { RecordedSource } from '../../playback/playbackSource.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { CoverGrid, STANDARD_GRID_SHAPE } from '../cover-tile/CoverGrid.tsx';
import { ARTIST_GRID_SHAPE } from '../cover-tile/ObjectTile.tsx';
import { shuffled } from '../online/onlineListRows.ts';
import { OnlineFailureView, OnlineNotice } from '../online/OnlineListStatus.tsx';
import { playbackPausedAtom } from '../playingAlbum.ts';
import { SearchResultList } from '../search/SearchResultList.tsx';
import { OnlineMessage } from '../search/online/OnlineEmpty.tsx';
import type { OnlineColumn, OnlineTrackSort } from '../search/online/onlineColumns.ts';
import {
  blockedTrack,
  OnlineTrackHeader,
  OnlineTrackRow,
  useUnblock,
} from '../search/online/OnlineItems.tsx';
import { OnlineObjectMenu } from '../search/online/OnlineObjectMenu.tsx';
import { OnlineTrackMenu } from '../search/online/OnlineTrackMenu.tsx';
import {
  OnlineAlbumTile,
  OnlineArtistTile,
  OnlinePlaylistTile,
  refKey,
} from '../search/online/OnlineTiles.tsx';
import { onlinePlayKey } from '../search/online/onlinePlay.ts';
import { useOnlineTileActions } from '../search/online/useOnlineTileActions.ts';
import {
  albumText,
  artistText,
  DEFAULT_SORT,
  playlistText,
  TRACK_SORT_FIELDS,
  trackRows,
  WALL_SORT_FIELDS,
  wallRows,
  type FavoriteSort,
  type TrackSortField,
  type WallSortField,
} from './favoritesRows.ts';
import { FavoritesHeader, TAB_KINDS, type FavoriteTab } from './FavoritesHeader.tsx';
import styles from './FavoritesPage.module.css';
import { useRetainedEntries } from './useRetainedEntries.ts';

const TRACK_CELL = { width: null, height: 40, stretch: true } as const;
/** 从收藏起播的来源：写「收藏」，点它回到收藏页 */
const FAVORITES_SOURCE: RecordedSource = { kind: 'onlineFavorites', subject: 'track', name: '' };
const keyOfTrack = (track: MusicTrack) => track.ref.id;
const playsOnEnter = () => true;

const TRACK_SORT_LABELS = {
  added: 'favorites.added',
  title: 'table.title',
  artist: 'table.artist',
  album: 'table.album',
  duration: 'table.duration',
} as const satisfies Record<TrackSortField, MessageKey>;
const WALL_SORT_LABELS = {
  added: 'favorites.added',
  name: 'favorites.sortName',
} as const satisfies Record<WallSortField, MessageKey>;

interface FavoritesSnapshot {
  readonly tab: FavoriteTab;
  readonly query: string;
  readonly trackSort: FavoriteSort<TrackSortField>;
  readonly wallSort: FavoriteSort<WallSortField>;
  readonly top: number;
}
const SLOT = createSnapshotSlot<FavoritesSnapshot>();

/** 字段换了：收藏时间缺省新到旧，其余缺省升序 */
const firstDirection = (field: string) => field === 'added';

/** 封面墙的图块：本页取消过收藏、还留着的淡一些，右键菜单里的「收藏」能收回来。每块都带这一层，免得取消时图块重挂 */
function KeptTile({
  removed,
  children,
}: {
  readonly removed: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.tile} data-removed={removed || undefined}>
      {children}
    </div>
  );
}

/**
 * 收藏页：页头、页签与命令栏、下面是曲目表或封面墙。条目来自本地收藏服务：收藏的身份启动时读好，快照按页签分页读；
 * 取消收藏后数据马上改，这一行却留在页里（心形变空、封面墙图块变淡，再点能收回来），离开页面才消失。
 * 曲目表选中两首以上时命令栏左半换成选区操作；放不下时先收「收藏时间」「音质」，再收「专辑」
 */
export function FavoritesPage() {
  const t = useAtomValueRawSync(translateAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const favorites = useService(onlineFavoritesKey);
  const player = useService(onlinePlayKey);
  const state = useAtomValueRawSync(favorites.state);
  const counts = useAtomValueRawSync(favorites.counts);
  // 取消收藏后数据马上改，这一行留在本页里，离开页面才消失；`removed` 是留着的里此刻不在收藏里的
  const liveTracks = useAtomValueRawSync(favorites.entries('track'));
  const { rows: trackEntries } = useRetainedEntries(liveTracks);
  const { rows: albumEntries, removed: albumRemoved } = useRetainedEntries(
    useAtomValueRawSync(favorites.entries('album')),
  );
  const { rows: artistEntries, removed: artistRemoved } = useRetainedEntries(
    useAtomValueRawSync(favorites.entries('artist')),
  );
  const { rows: playlistEntries, removed: playlistRemoved } = useRetainedEntries(
    useAtomValueRawSync(favorites.entries('playlist')),
  );
  const playing = useAtomValueRawSync(playingOnlineKeyAtom);
  const paused = useAtomValueRawSync(playbackPausedAtom);
  const unblock = useUnblock();
  const [measure, tier] = useWidthTier<CommandBarTier>(COMMAND_BAR_TIERS);

  const [tab, setTab] = useState<FavoriteTab>('tracks');
  const [query, setQuery] = useState('');
  const [trackSort, setTrackSort] = useState<FavoriteSort<TrackSortField>>(DEFAULT_SORT);
  const [wallSort, setWallSort] = useState<FavoriteSort<WallSortField>>(DEFAULT_SORT);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly MusicTrack[]>([]);
  /** 换一个值就重画曲目表，选中也随之清掉 */
  const [listKey, setListKey] = useState(0);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [trackMenu, setTrackMenu] = useState<{
    readonly at: TablePoint;
    readonly tracks: readonly MusicTrack[];
  } | null>(null);
  const [restoreTop, setRestoreTop] = useState<number | null>(null);
  const { tileActions, menu: tileMenu, closeMenu } = useOnlineTileActions(setNotice);

  const kind = TAB_KINDS[tab];
  // 播放全部要曲目的快照，所以曲目一直要；别的页签再要自己那一类
  useEffect(() => favorites.want('track'), [favorites]);
  useEffect(() => (kind === 'track' ? undefined : favorites.want(kind)), [favorites, kind]);
  const snapshotPhase = useAtomValueRawSync(favorites.snapshotPhase(kind));

  const collator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
    [locale],
  );
  const tracks = useMemo(
    () => trackRows(trackEntries, query, trackSort, collator),
    [trackEntries, query, trackSort, collator],
  );
  const trackItems = useMemo(() => tracks.map((entry) => entry.item), [tracks]);
  // 序号与收藏时间按曲目 ID 查，曲目表的条目就是曲目本身，行组件的记忆化才管用
  const numbers = useMemo(
    () => new Map(tracks.map((entry, index) => [entry.item.ref.id, String(index + 1)])),
    [tracks],
  );
  const addedAt = useMemo(
    () => new Map(tracks.map((entry) => [entry.item.ref.id, entry.addedAt])),
    [tracks],
  );
  const albums = useMemo(
    () => wallRows(albumEntries, query, wallSort, collator, albumText, (album) => album.title),
    [albumEntries, query, wallSort, collator],
  );
  const artists = useMemo(
    () => wallRows(artistEntries, query, wallSort, collator, artistText, (artist) => artist.name),
    [artistEntries, query, wallSort, collator],
  );
  const playlists = useMemo(
    () => wallRows(playlistEntries, query, wallSort, collator, playlistText, (list) => list.title),
    [playlistEntries, query, wallSort, collator],
  );
  const albumItems = useMemo(() => albums.map((entry) => entry.item), [albums]);
  const artistItems = useMemo(() => artists.map((entry) => entry.item), [artists]);
  const playlistItems = useMemo(() => playlists.map((entry) => entry.item), [playlists]);
  // 播放全部不跟别的页签的查找走：在曲目页签里是显示的全部，别处是全部收藏的曲目；本页取消过、还留着的行不算
  const playAll = useMemo(
    () =>
      trackRows(liveTracks, tab === 'tracks' ? query : '', trackSort, collator).map(
        (entry) => entry.item,
      ),
    [liveTracks, tab, query, trackSort, collator],
  );

  const start = (rows: readonly MusicTrack[], index: number) => {
    setNotice(null);
    void player.play(rows, index, FAVORITES_SOURCE).then((ok) => {
      if (!ok) setNotice('songs.playFailed');
    });
  };
  const queue = (rows: readonly MusicTrack[], next: boolean) =>
    void player.queue(rows, next).then((ok) => setNotice(ok ? null : 'online.queueFailed'));

  const clearPicked = useCallback(() => {
    setPicked([]);
    setListKey((key) => key + 1);
  }, []);

  // 离开再回来：页签、查找、排序与滚动位置都恢复
  usePageSnapshot(
    SLOT,
    {
      capture: () => ({ tab, query, trackSort, wallSort, top: scroller?.scrollTop ?? 0 }),
      restore: (snapshot) => {
        setTab(snapshot.tab);
        setQuery(snapshot.query);
        setTrackSort(snapshot.trackSort);
        setWallSort(snapshot.wallSort);
        setRestoreTop(snapshot.top);
      },
    },
    state.phase !== 'loading' && scroller !== null,
  );
  const rowsReady = state.phase === 'ready' && snapshotPhase === 'ready';
  useLayoutEffect(() => {
    if (restoreTop === null || !scroller || !rowsReady) return;
    scroller.scrollTop = restoreTop;
    setRestoreTop(null);
  }, [restoreTop, scroller, rowsReady]);

  const onTab = (next: FavoriteTab) => {
    setTab(next);
    setActive(null);
    clearPicked();
  };
  const sortField = tab === 'tracks' ? trackSort.field : wallSort.field;
  const onSort = (field: string) => {
    if (tab === 'tracks') {
      const next = TRACK_SORT_FIELDS.find((value) => value === field);
      if (next) setTrackSort({ field: next, descending: firstDirection(next) });
      return;
    }
    const next = WALL_SORT_FIELDS.find((value) => value === field);
    if (next) setWallSort({ field: next, descending: firstDirection(next) });
  };
  const onDescending = (descending: boolean) => {
    if (tab === 'tracks') setTrackSort((now) => ({ ...now, descending }));
    else setWallSort((now) => ({ ...now, descending }));
  };

  // 曲目表列头的排序：点同一列反向，点别的列按那一列的缺省方向，点 # 回到缺省
  const headerSort: OnlineTrackSort = {
    column: trackSort.field,
    descending: trackSort.descending,
  };
  const onHeaderSort = (column: OnlineColumn) => {
    if (column === 'number') {
      setTrackSort(DEFAULT_SORT);
      return;
    }
    const next = TRACK_SORT_FIELDS.find((value) => value === column);
    if (!next) return;
    setTrackSort((now) =>
      now.field === next
        ? { field: next, descending: !now.descending }
        : { field: next, descending: firstDirection(next) },
    );
  };

  const sortOptions =
    tab === 'tracks'
      ? TRACK_SORT_FIELDS.map((value) => ({ value, label: t(TRACK_SORT_LABELS[value]) }))
      : WALL_SORT_FIELDS.map((value) => ({ value, label: t(WALL_SORT_LABELS[value]) }));
  const sort = tab === 'tracks' ? trackSort : wallSort;

  const shownCount = {
    tracks: tracks.length,
    albums: albums.length,
    artists: artists.length,
    playlists: playlists.length,
  }[tab];
  // 留着的行也算：最后一条取消后行还在，这一页不写「还没有收藏」
  const keptCount = {
    tracks: trackEntries.length,
    albums: albumEntries.length,
    artists: artistEntries.length,
    playlists: playlistEntries.length,
  }[tab];
  const retry = () => favorites.retry();
  let content: ReactNode;
  if (state.phase === 'loading') {
    content = (
      <div className={styles.status}>
        <Spinner aria-label={t('album.loading')} />
      </div>
    );
  } else if (state.phase === 'unavailable') {
    content = (
      <OnlineFailureView failure={state.failure} retry={retry} title={t('favorites.failed')} />
    );
  } else if (counts[kind] === 0 && keptCount === 0) {
    content = <OnlineMessage icon={<Heart48Regular />} title={t('favorites.empty')} />;
  } else if (snapshotPhase === 'failed' && shownCount === 0) {
    content = <OnlineFailureView failure={null} retry={retry} title={t('favorites.failed')} />;
  } else if (snapshotPhase !== 'ready' && shownCount === 0) {
    content = (
      <div className={styles.status}>
        <Spinner aria-label={t('album.loading')} />
      </div>
    );
  } else if (shownCount === 0) {
    content = <OnlineMessage icon={<Heart48Regular />} title={t('favorites.noMatches')} />;
  } else if (tab === 'tracks') {
    content = (
      <SearchResultList
        key={listKey}
        items={trackItems}
        keyOf={keyOfTrack}
        cell={TRACK_CELL}
        playsOnEnter={playsOnEnter}
        renderItem={(track, props) => (
          <OnlineTrackRow
            {...props}
            track={track}
            layout="favorites"
            number={numbers.get(track.ref.id) ?? ''}
            playing={onlineKey(track.ref) === playing}
            paused={paused}
            unblock={unblock}
            added={addedAt.get(track.ref.id)}
          />
        )}
        label={t('favorites.tab.tracks')}
        view="favorites"
        scroller={scroller}
        active={active}
        onActive={setActive}
        onActivate={(track) => {
          if (!blockedTrack(track, unblock)) start(trackItems, trackItems.indexOf(track));
        }}
        onMenu={(_, at, selected) => setTrackMenu({ at, tracks: selected })}
        onAll={async () => trackItems}
        onSelected={setPicked}
        header={
          <OnlineTrackHeader
            layout="favorites"
            sort={headerSort}
            orderLabel={t('favorites.added')}
            onSort={onHeaderSort}
          />
        }
      />
    );
  } else if (tab === 'albums') {
    content = (
      <CoverGrid
        shape={STANDARD_GRID_SHAPE}
        keyOf={refKey}
        items={albumItems}
        scroller={scroller}
        label={t('favorites.tab.albums')}
        render={(album) => (
          <KeptTile removed={albumRemoved.has(refKey(album))}>
            <OnlineAlbumTile album={album} {...tileActions(album)} />
          </KeptTile>
        )}
      />
    );
  } else if (tab === 'artists') {
    content = (
      <CoverGrid
        shape={ARTIST_GRID_SHAPE}
        keyOf={refKey}
        // 与搜索结果里的艺人一样：末行不满时居中；快照还在分页读时末行会随续页补满，读完再居中，免得末行跳位
        centerTail={snapshotPhase === 'ready'}
        items={artistItems}
        scroller={scroller}
        label={t('favorites.tab.artists')}
        render={(artist) => (
          <KeptTile removed={artistRemoved.has(refKey(artist))}>
            <OnlineArtistTile artist={artist} {...tileActions(artist)} />
          </KeptTile>
        )}
      />
    );
  } else {
    content = (
      <CoverGrid
        shape={STANDARD_GRID_SHAPE}
        keyOf={refKey}
        items={playlistItems}
        scroller={scroller}
        label={t('favorites.tab.playlists')}
        render={(playlist) => (
          <KeptTile removed={playlistRemoved.has(refKey(playlist))}>
            <OnlinePlaylistTile playlist={playlist} {...tileActions(playlist)} />
          </KeptTile>
        )}
      />
    );
  }

  return (
    <section
      ref={measure}
      className={styles.root}
      aria-label={t('place.favorites')}
      data-page="favorites"
      data-tier={tier}
    >
      <FavoritesHeader
        tier={tier}
        tab={tab}
        onTab={onTab}
        counts={counts}
        ready={state.phase === 'ready'}
        query={query}
        onQuery={setQuery}
        sortOptions={sortOptions}
        sortField={sortField}
        descending={sort.descending}
        onSort={onSort}
        onDescending={onDescending}
        playable={playAll.length > 0}
        onPlayAll={() => start(playAll, 0)}
        onShuffle={() => start(shuffled(playAll), 0)}
        onQueueAll={() => queue(playAll, false)}
        selection={
          tab === 'tracks' && picked.length > 1
            ? {
                count: picked.length,
                onPlay: () => start(picked, 0),
                onNext: () => queue(picked, true),
                onEnqueue: () => queue(picked, false),
                onUnfavorite: () => {
                  void favorites.remove(
                    'track',
                    picked.map((track) => track.ref),
                  );
                  clearPicked();
                },
                onClear: clearPicked,
              }
            : null
        }
      />
      {notice && (
        <div className={styles.notice}>
          <OnlineNotice notice={notice} onDismiss={() => setNotice(null)} />
        </div>
      )}
      <div ref={setScroller} className={styles.scroller} data-favorites-scroller>
        {content}
      </div>
      <OnlineTrackMenu
        menu={trackMenu}
        onClose={() => setTrackMenu(null)}
        onPlay={(selected) => {
          const only = selected.length === 1 ? selected[0] : undefined;
          if (only) start(trackItems, trackItems.indexOf(only));
          else start(selected, 0);
        }}
        onQueued={(ok) => setNotice(ok ? null : 'online.queueFailed')}
      />
      <OnlineObjectMenu menu={tileMenu} onClose={closeMenu} onFailed={setNotice} />
    </section>
  );
}
