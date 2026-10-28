import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
} from '@fluentui/react-components';
import { ErrorCircle48Regular, Search48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { CoverTheme } from '../../covers/CoverTheme.tsx';
import type { MessageKey } from '../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { readOnlineListSubject, type OnlineListSubject, type PageProps } from '../../nav/places.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { musicStatusKey } from '../../playback/musicStatus.ts';
import { onlineListKey, onlineListsKey } from '../../playback/onlineLists.ts';
import { onlineCoverUrl, onlineKey } from '../../playback/onlineTracks.ts';
import { playingOnlineKeyAtom } from '../../playback/playback.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { playbackSourceAtom } from '../../playback/playbackSource.ts';
import type { MusicListKind } from '../../server/musicProtocol.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { DetailFrame } from '../detail/DetailFrame.tsx';
import { DetailTools } from '../detail/DetailTools.tsx';
import { playbackPausedAtom } from '../playingAlbum.ts';
import { SearchResultList } from '../search/SearchResultList.tsx';
import { NcmSetupPanel, OnlineMessage, OnlineUnavailable } from '../search/online/OnlineEmpty.tsx';
import {
  blockedTrack,
  ONLINE_COLUMN_LABELS,
  OnlineTrackHeader,
  OnlineTrackRow,
  useUnblock,
  type OnlineTrackSort,
} from '../search/online/OnlineItems.tsx';
import { OnlineObjectMenu, objectTargetOf } from '../search/online/OnlineObjectMenu.tsx';
import { onlineListSource, onlinePlayKey } from '../search/online/onlinePlay.ts';
import { OnlineMore } from '../search/online/OnlineMore.tsx';
import { OnlineTrackMenu } from '../search/online/OnlineTrackMenu.tsx';
import { ArtistReleasePane } from './ArtistReleasePane.tsx';
import { ArtistReleaseTools, ArtistTabs } from './ArtistTools.tsx';
import { OnlineListHeader, ownerCover, ownerName } from './OnlineListHeader.tsx';
import { failureDetail } from './onlineFailure.ts';
import { useArtistReleases, type ArtistSnapshot } from './useArtistReleases.ts';
import {
  nextOnlineSort,
  onlineListRows,
  onlineSort,
  onlineSortFields,
  type OnlineSortField,
} from './onlineListRows.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import styles from './OnlineListPage.module.css';

const ORDER_LABELS = {
  album: 'albumDetail.albumOrder',
  playlist: 'onlineList.order.playlist',
  artist: 'onlineList.order.artist',
} as const satisfies Record<MusicListKind, MessageKey>;
const MISSING = {
  album: 'onlineList.missing.album',
  playlist: 'onlineList.missing.playlist',
  artist: 'onlineList.missing.artist',
} as const satisfies Record<MusicListKind, MessageKey>;
const FAILED = {
  album: 'onlineList.failed.album',
  playlist: 'onlineList.failed.playlist',
  artist: 'onlineList.failed.artist',
} as const satisfies Record<MusicListKind, MessageKey>;
const TRACK_CELL = { width: null, height: 40, stretch: true } as const;
const NO_TRACKS: readonly MusicTrack[] = [];
const keyOfTrack = (track: MusicTrack) => track.ref.id;
const playsOnEnter = () => true;

interface ListSnapshot {
  readonly top: number;
  readonly active: string | null;
  readonly sort: OnlineTrackSort | null;
  readonly query: string;
  /** 离开时已取到的曲目数：歌单的缓存被丢掉时，回来先补到这么多再恢复滚动 */
  readonly loaded: number;
  /** 艺人页的页签与各页签的查找、排序、版本筛选 */
  readonly artist?: ArtistSnapshot;
}
const SLOT = createSnapshotSlot<ListSnapshot>();

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

/**
 * 在线列表页：在线专辑、歌单（含榜单）与艺人的热门曲目共用。页头照本地专辑详情页，工具行的查找与排序只作用于
 * 已取到的曲目；歌单滚到底接着取。数据由在线列表服务按列表缓存，后退、前进回来不必重取
 */
export function OnlineListPage({ place }: PageProps) {
  const list = useMemo(() => readOnlineListSubject(place.subject ?? ''), [place.subject]);
  // 主体只由地点表写入；读不出时（存下的来源被改坏）不画内容，后退照常可用
  if (!list) return null;
  return <OnlineList key={onlineListKey(list)} list={list} />;
}

function OnlineList({ list }: { readonly list: OnlineListSubject }) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const lists = useService(onlineListsKey);
  const player = useService(onlinePlayKey);
  const playback = useService(playbackKey);
  const status = useService(musicStatusKey);
  const unblock = useUnblock();
  const state = useAtomValueRawSync(lists.lists).get(onlineListKey(list));
  const playing = useAtomValueRawSync(playingOnlineKeyAtom);
  const source = useAtomValueRawSync(playbackSourceAtom);
  const paused = useAtomValueRawSync(playbackPausedAtom);
  useEffect(() => lists.want(list), [lists, list]);
  useEffect(() => status.refresh(), [status]);

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // 量到宽度之前是 null：头部的高随宽窄变，交还的滚动要等它定下来
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const [sort, setSort] = useState<OnlineTrackSort | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [trackMenu, setTrackMenu] = useState<{
    readonly at: TablePoint;
    readonly tracks: readonly MusicTrack[];
  } | null>(null);
  const [objectMenu, setObjectMenu] = useState<TablePoint | null>(null);
  const [restoring, setRestoring] = useState<ListSnapshot | null>(null);
  const artistName = state?.owner ? ownerName(state.owner) : list.title;
  const releases = useArtistReleases(list.kind === 'artist' ? list.ref : null, artistName, locale);
  const releaseTab = list.kind === 'artist' && releases.tab !== 'songs';

  const owner = state?.owner ?? null;
  const items = state?.items ?? NO_TRACKS;
  const ready = state?.phase === 'ready';
  const layout = list.kind === 'album' ? 'album' : 'list';
  const collator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
    [locale],
  );
  const rows = useMemo(
    () => onlineListRows(items, query, sort, collator),
    [items, query, sort, collator],
  );
  const numbers = useMemo(
    () => new Map(items.map((track, index) => [track, String(index + 1)])),
    [items],
  );
  const playedHere = (() => {
    if (!playing || !source || source.kind !== onlineListSource(list).kind) return false;
    const from = readOnlineListSubject(source.subject);
    return from?.ref.platform === list.ref.platform && from.ref.id === list.ref.id;
  })();
  const cover = owner ? ownerCover(owner) : null;

  // 起播来源写此刻的名字：进来时带的名字可能是搜索结果里的旧写法
  const start = (tracks: readonly MusicTrack[], index: number) => {
    setNotice(null);
    const named = { ...list, title: owner ? ownerName(owner) : list.title };
    void player.play(tracks, index, onlineListSource(named)).then((ok) => {
      if (!ok) setNotice('songs.playFailed');
    });
  };
  const queue = (tracks: readonly MusicTrack[], next: boolean) =>
    void player.queue(tracks, next).then((ok) => setNotice(ok ? null : 'online.queueFailed'));

  usePageSnapshot(
    SLOT,
    {
      capture: () => ({
        top: scroller?.scrollTop ?? 0,
        active,
        sort,
        query,
        loaded: items.length,
        ...(list.kind === 'artist' ? { artist: releases.capture() } : {}),
      }),
      restore: (snapshot) => {
        setRestoring(snapshot);
        setSort(snapshot.sort);
        setQuery(snapshot.query);
        if (snapshot.artist) releases.restore(snapshot.artist);
      },
    },
    ready && scroller !== null && narrow !== null,
  );
  // 返回时先补回离开时已取到的条数，再恢复滚动与焦点行
  useLayoutEffect(() => {
    if (!restoring || state?.phase !== 'ready' || !scroller) return;
    // 回到专辑页签时，等专辑取到再恢复滚动：页高要等网格画出来才定
    const wanted = restoring.artist?.tab;
    if (wanted && wanted !== 'songs' && (!releases.state || releases.state.phase === 'loading'))
      return;
    if (restoring.loaded > state.items.length && state.cursor !== null && !state.moreFailed) {
      if (!state.loadingMore) void lists.more(list);
      return;
    }
    setRestoring(null);
    setActive(restoring.active);
    scroller.scrollTop = restoring.top;
  }, [restoring, state, releases.state, scroller, lists, list]);

  const failure = state?.phase === 'failed' ? state.failure : null;
  const retry = () => lists.retry(list);
  const sortField: OnlineSortField =
    sort && sort.column !== 'cover' && sort.column !== 'menu' ? sort.column : 'number';
  const orderLabel = t(ORDER_LABELS[list.kind]);

  return (
    <CoverTheme url={cover ? onlineCoverUrl(cover, 256) : ''}>
      <DetailFrame
        label={owner ? ownerName(owner) : list.title}
        page="onlineList"
        glow={owner !== null}
        intro={
          owner ? (
            <>
              <OnlineListHeader
                owner={owner}
                loaded={items.length}
                narrow={narrow === true}
                playing={playedHere}
                paused={paused}
                usable={items.length > 0}
                onPlay={() => (playedHere ? void playback.playOrPause() : start(items, 0))}
                onShuffle={() => start(shuffled(items), 0)}
                onQueue={() => queue(items, false)}
                onMenu={setObjectMenu}
              />
              {notice && (
                <MessageBar className={styles.notice} intent="warning" data-online-list-notice>
                  <MessageBarBody>{t(notice)}</MessageBarBody>
                  <MessageBarActions>
                    <Button
                      className={viewControls.field}
                      size="small"
                      onClick={() => setNotice(null)}
                    >
                      {t('album.dismiss')}
                    </Button>
                  </MessageBarActions>
                </MessageBar>
              )}
              {releaseTab ? (
                <ArtistReleaseTools releases={releases} />
              ) : (
                <DetailTools
                  query={query}
                  onQuery={setQuery}
                  fields={onlineSortFields(layout)}
                  field={sortField}
                  descending={sort?.descending ?? false}
                  sorted={sort !== null}
                  label={(field) =>
                    field === 'number' ? orderLabel : t(ONLINE_COLUMN_LABELS[field])
                  }
                  onSort={(field, descending) => setSort(onlineSort(field, descending))}
                  start={
                    list.kind !== 'artist' ? undefined : releases.tabs.length > 1 ? (
                      <ArtistTabs releases={releases} />
                    ) : (
                      t('onlineList.top', { count: items.length })
                    )
                  }
                />
              )}
            </>
          ) : failure === 'not-installed' ? (
            <NcmSetupPanel onReady={retry} />
          ) : failure === 'backend-unavailable' ? (
            <OnlineUnavailable onRetry={retry} />
          ) : failure === 'not-found' ? (
            <OnlineMessage icon={<Search48Regular />} title={t(MISSING[list.kind])} />
          ) : failure ? (
            <OnlineMessage
              icon={<ErrorCircle48Regular />}
              title={t(FAILED[list.kind])}
              detail={failureDetail(failure, t)}
              action={{ label: t('album.retry'), run: retry }}
            />
          ) : (
            <Spinner className={styles.spinner} aria-label={t('album.loading')} />
          )
        }
        overlay={
          <>
            <OnlineTrackMenu
              menu={trackMenu}
              onClose={() => setTrackMenu(null)}
              onPlay={(picked) => {
                const only = picked.length === 1 ? picked[0] : undefined;
                if (only) start(rows, rows.indexOf(only));
                else start(picked, 0);
              }}
              onQueued={(ok) => setNotice(ok ? null : 'online.queueFailed')}
            />
            <OnlineObjectMenu
              menu={
                owner && objectMenu
                  ? { at: objectMenu, target: { ...objectTargetOf(owner), tracks: items } }
                  : null
              }
              here
              onClose={() => setObjectMenu(null)}
              onFailed={setNotice}
            />
          </>
        }
        onScroller={setScroller}
        onNarrow={setNarrow}
      >
        {owner && releaseTab && (
          <ArtistReleasePane
            releases={releases}
            scroller={scroller}
            setNotice={setNotice}
            preview={releases.tab === 'albums'}
            artist={list.ref}
            name={artistName}
          />
        )}
        {owner && !releaseTab && (
          <>
            <SearchResultList
              items={rows}
              keyOf={keyOfTrack}
              cell={TRACK_CELL}
              playsOnEnter={playsOnEnter}
              renderItem={(track, props) => (
                <OnlineTrackRow
                  {...props}
                  track={track}
                  layout={layout}
                  number={numbers.get(track) ?? ''}
                  playing={onlineKey(track.ref) === playing}
                  paused={paused}
                  unblock={unblock}
                />
              )}
              label={t('albumDetail.table')}
              view="online-list"
              scroller={scroller}
              active={active}
              onActive={setActive}
              onActivate={(track) => {
                if (!blockedTrack(track, unblock)) start(rows, rows.indexOf(track));
              }}
              onMenu={(_, at, picked) => setTrackMenu({ at, tracks: picked })}
              onAll={async () => rows}
              header={
                <OnlineTrackHeader
                  layout={layout}
                  sort={sort}
                  orderLabel={orderLabel}
                  onSort={(column) => setSort((now) => nextOnlineSort(now, column))}
                />
              }
            />
            {rows.length === 0 && query.trim() !== '' && (
              <p className={styles.empty} data-online-list-no-matches>
                {t('albumDetail.noMatches')}
              </p>
            )}
            {state && (
              <OnlineMore
                more={state.cursor !== null}
                loadingMore={state.loadingMore}
                moreFailed={state.moreFailed}
                scroller={scroller}
                onMore={() => void lists.more(list)}
              />
            )}
          </>
        )}
      </DetailFrame>
    </CoverTheme>
  );
}
