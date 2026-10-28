import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MessageKey } from '../../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { COMMAND_BAR_TIERS, type CommandBarTier } from '../../../kit/CommandBar.tsx';
import { useService } from '../../../kit/useService.ts';
import { useWidthTier } from '../../../kit/useWidthTier.ts';
import { pageTransition } from '../../../motion/pageTransition.ts';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { createSnapshotSlot } from '../../../nav/navHistory.ts';
import { usePageSnapshot } from '../../../nav/usePageSnapshot.ts';
import { musicStatusKey } from '../../../playback/musicStatus.ts';
import { onlineKey } from '../../../playback/onlineTracks.ts';
import { playingOnlineKeyAtom } from '../../../playback/playback.ts';
import type { MusicSearchKind } from '../../../server/musicProtocol.ts';
import type { MusicPlatform, MusicTrack } from '../../../server/musicObjects.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { SearchResultList } from '../SearchResultList.tsx';
import {
  NcmSetupPanel,
  OnlineNoResults,
  OnlineSearchFailed,
  OnlineUnavailable,
} from './OnlineEmpty.tsx';
import { blockedTrack, OnlineTrackHeader, OnlineTrackRow, useUnblock } from './OnlineItems.tsx';
import {
  OnlineAlbumTile,
  OnlineArtistTile,
  OnlinePlaylistTile,
  ONLINE_ARTIST_SHAPE,
  refKey,
} from './OnlineTiles.tsx';
import { CoverGrid, STANDARD_GRID_SHAPE } from '../../cover-tile/CoverGrid.tsx';
import { ONLINE_CATEGORY_LABELS, ONLINE_KIND_LABELS, OnlineOverview } from './OnlineOverview.tsx';
import { onlinePlayKey, onlineSearchSource } from './onlinePlay.ts';
import {
  searchableKinds,
  type OnlineCategory,
  type OnlineKindState,
  type OnlineSearch,
} from './onlineSearch.ts';
import { ONLINE_KIND_OF as KIND_OF, OnlineControls, platformSearches } from './OnlineControls.tsx';
import { onlineSourcesKey } from './onlineSources.ts';
import { OnlineMore } from './OnlineMore.tsx';
import { OnlineObjectMenu } from './OnlineObjectMenu.tsx';
import { useOnlineTileActions } from './useOnlineTileActions.ts';
import { OnlineTrackMenu } from './OnlineTrackMenu.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import {
  OnlineFilterConditions,
  OnlineFilterEmpty,
  OnlineFilterSurface,
  OnlineFilterTools,
} from './OnlineFilter.tsx';
import { useOnlineFilter, type OnlineFilterView } from './useOnlineFilter.ts';
import { useOnlineFilterSurface } from './useOnlineFilterSurface.ts';
import styles from './OnlineResults.module.css';

const TRACK_CELL = { width: null, height: 40, stretch: true } as const;
const keyOfTrack = (track: MusicTrack) => track.ref.id;
const playsOnEnter = () => true;

interface OnlineSnapshot {
  readonly category: OnlineCategory;
  /** 离开时看的来源：回来时一起恢复 */
  readonly platform: MusicPlatform;
  readonly top: number;
  readonly active: string | null;
  readonly loaded: number;
  /** 字段与筛选条件 */
  readonly filtering: OnlineFilterView;
}
const SLOT = createSnapshotSlot<OnlineSnapshot>();

/** 切到媒体库范围时记下的在线范围现场，切回来照它恢复；只对同一个查询词有效 */
export interface OnlineResume {
  readonly text: string;
  readonly view: OnlineSnapshot;
}

export interface OnlineResultsProps {
  readonly text: string;
  readonly search: OnlineSearch;
  readonly initial: OnlineCategory;
  /** 进来时选中并滚到这首曲目（平台内的 ID） */
  readonly focus?: string;
  /** 范围切换之间保留现场：卸载时写入，挂上时有同一查询词的现场就盖过 `initial` 与 `focus` */
  readonly resume: { current: OnlineResume | null };
}

/**
 * 搜索结果页的在线音乐范围：分类照本地结果页，再加歌单；分类行右端的来源下拉在可选来源多于网易云时出，
 * 换来源只换下面的结果，各来源已取到的结果留着，切回来不重搜
 */
export function OnlineResults({ text, search, initial, focus, resume }: OnlineResultsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const player = useService(onlinePlayKey);
  const status = useService(musicStatusKey);
  const sources = useService(onlineSourcesKey);
  const sourceOptions = useAtomValueRawSync(sources.options);
  const platform = useAtomValueRawSync(search.platform);
  const unblock = useUnblock();
  const playing = useAtomValueRawSync(playingOnlineKeyAtom);
  const kinds = {
    track: useAtomValueRawSync(search.kinds.track),
    album: useAtomValueRawSync(search.kinds.album),
    artist: useAtomValueRawSync(search.kinds.artist),
    playlist: useAtomValueRawSync(search.kinds.playlist),
  };
  const [resumed] = useState(() => (resume.current?.text === text ? resume.current.view : null));
  const [category, setCategory] = useState(resumed?.category ?? initial);
  const [active, setActive] = useState<string | null>(resumed ? resumed.active : (focus ?? null));
  const focusing = useRef(resumed ? undefined : focus);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{
    readonly at: TablePoint;
    readonly tracks: readonly MusicTrack[];
  } | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const { tileActions, menu: objectMenu, closeMenu } = useOnlineTileActions(setNotice);
  const pending = useRef<OnlineSnapshot | null>(resumed);
  const tracks = kinds.track.items;
  // 字段或条件一变，选中项和菜单作废，列表回到顶上
  const filtering = useOnlineFilter(tracks, text, unblock, {
    initial: resumed?.filtering,
    onRefine: () => {
      setMenu(null);
      setActive(null);
      if (scroller) scroller.scrollTop = 0;
    },
  });
  const [measure, tier] = useWidthTier<CommandBarTier, HTMLDivElement>(COMMAND_BAR_TIERS);
  const surface = useOnlineFilterSurface(tier === 'narrow');
  // 只有「曲目」分类按字段与条件筛；「全部」里的预览仍是取到的原样
  const queue = category === 'tracks' ? filtering.shown : tracks;
  // 「全部」只取这个平台搜得了的类；平台搜不了的分类选不上
  const wanted = useMemo(
    () => (category === 'all' ? searchableKinds(platform) : [KIND_OF[category]]),
    [category, platform],
  );
  const reload = useCallback(() => search.load(wanted), [search, wanted]);
  useEffect(() => status.refresh(), [status]);
  useEffect(() => reload(), [reload]);
  // 换到搜不了当前分类的平台时落到「曲目」；进来时带的分类（下拉里的「查看全部」）同理
  useEffect(() => {
    if (!platformSearches(platform, category)) setCategory('tracks');
  }, [platform, category]);

  const states: OnlineKindState<MusicSearchKind>[] = wanted.map((kind) => kinds[kind]);
  const failures = states.flatMap((state) => (state.status === 'failed' ? [state.failure] : []));
  const failedKinds = wanted.filter((kind) => kinds[kind].status === 'failed');
  const pendingKinds = wanted.filter(
    (kind) => kinds[kind].status === 'idle' || kinds[kind].status === 'loading',
  );
  const loading = pendingKinds.length > 0;
  // 已有结果时不整页转圈：「全部」里还在取的类别只在自己那一节显示忙碌，重试也不让已显示的结果消失
  const shown = states.some((state) => state.items.length > 0);
  const ready = !loading && failures.length < states.length;
  const focusKind = category === 'all' ? null : KIND_OF[category];
  const focusState = focusKind ? kinds[focusKind] : null;

  const capture = (): OnlineSnapshot => ({
    category,
    platform,
    top: scroller?.scrollTop ?? 0,
    active,
    loaded: focusState?.items.length ?? 0,
    filtering: { scope: filtering.scope, filter: filtering.filter },
  });
  usePageSnapshot(
    SLOT,
    {
      capture,
      restore: (snapshot) => {
        pending.current = snapshot;
        setCategory(snapshot.category);
        filtering.restore(snapshot.filtering);
        sources.choose(snapshot.platform);
      },
    },
    ready && !!scroller,
  );
  // 卸载时滚动区还在文档里，布局阶段的清理读得到滚动位置
  const latestCapture = useRef(capture);
  useLayoutEffect(() => {
    latestCapture.current = capture;
  });
  useLayoutEffect(
    () => () => {
      resume.current = { text, view: latestCapture.current() };
    },
    [resume, text],
  );
  // 排在恢复现场的 effect 之前：同一次提交里恢复会先清掉 pending，排在后面就看不到它，返回时会误播切分类的上滑
  const view = `${platform}:${category}`;
  const switching = useRef(view);
  useLayoutEffect(() => {
    if (switching.current === view || !scroller) return;
    switching.current = view;
    if (pending.current || reduced || document.visibilityState !== 'visible') return;
    const animations = pageTransition('refresh', 'forward', false).enter.map((motion) =>
      scroller.animate(motion.keyframes, motion.options),
    );
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [view, scroller, reduced]);
  // 返回时先补回离开时已加载的条数，再恢复滚动与焦点项
  useLayoutEffect(() => {
    const saved = pending.current;
    if (!saved || saved.category !== category || !scroller || !ready) return;
    if (focusKind && focusState && saved.loaded > focusState.items.length) {
      if (focusState.loadingMore) return;
      if (focusState.cursor !== null && !focusState.moreFailed) {
        void search.more(focusKind);
        return;
      }
    }
    pending.current = null;
    setActive(saved.active);
    scroller.scrollTop = saved.top;
  }, [category, scroller, ready, focusKind, focusState, search]);

  // 列表按选中项保证那一行已画出；画出后滚过去一次
  useLayoutEffect(() => {
    const id = focusing.current;
    const row = id && scroller?.querySelector(`[data-online-track="${CSS.escape(id)}"]`);
    if (!row) return;
    focusing.current = undefined;
    row.scrollIntoView({ block: 'center' });
  });

  const choose = (next: OnlineCategory) => {
    if (next === category) return;
    setMenu(null);
    surface.setOpen(false);
    setCategory(next);
    setActive(null);
    if (scroller) scroller.scrollTop = 0;
  };
  const chooseSource = (next: MusicPlatform) => {
    if (next === platform) return;
    setMenu(null);
    setActive(null);
    if (scroller) scroller.scrollTop = 0;
    sources.choose(next);
  };

  const play = useCallback(
    (track: MusicTrack) => {
      setNotice(null);
      void player.play(queue, queue.indexOf(track), onlineSearchSource(text)).then((ok) => {
        if (!ok) setNotice('songs.playFailed');
      });
    },
    [player, queue, text],
  );
  const activate = useCallback(
    (track: MusicTrack) => {
      setActive(keyOfTrack(track));
      if (!blockedTrack(track, unblock)) play(track);
    },
    [play, unblock],
  );
  const openMenu = useCallback(
    (track: MusicTrack, at: TablePoint, selection: readonly MusicTrack[] = [track]) => {
      setActive(keyOfTrack(track));
      setMenu({ at, tracks: selection });
    },
    [],
  );
  // 「曲目」分类的列头放在滚动区外面，滚动时不跟着走；「全部」里的预览照本地结果页不带列头
  const headed = category === 'tracks' && shown;
  const trackList = (items: readonly MusicTrack[], label: string) => (
    <div className={styles.table}>
      <SearchResultList
        items={items}
        keyOf={keyOfTrack}
        cell={TRACK_CELL}
        playsOnEnter={playsOnEnter}
        renderItem={(track, props) => (
          <OnlineTrackRow
            {...props}
            track={track}
            playing={onlineKey(track.ref) === playing}
            unblock={unblock}
          />
        )}
        label={label}
        view="online-tracks"
        scroller={scroller}
        active={active}
        onActive={setActive}
        onActivate={activate}
        onMenu={openMenu}
        onAll={async () => items}
      />
    </div>
  );

  const body = () => {
    if (failures.includes('not-installed')) return <NcmSetupPanel onReady={reload} />;
    if (failures.includes('backend-unavailable')) return <OnlineUnavailable onRetry={reload} />;
    if (!loading && failures.length === states.length)
      return <OnlineSearchFailed platform={platform} onRetry={reload} />;
    if (!shown) {
      if (loading) return <Spinner className={styles.spinner} size="small" />;
      return <OnlineNoResults platform={platform} text={text} />;
    }
    if (category === 'all')
      return (
        <OnlineOverview
          text={text}
          pending={pendingKinds}
          artists={kinds.artist.items}
          albums={kinds.album.items}
          tracks={tracks}
          playlists={kinds.playlist.items}
          onChoose={choose}
          onPlay={activate}
          tileActions={tileActions}
          renderTracks={(items) => trackList(items, t('search.tracks'))}
        />
      );
    if (category === 'tracks') {
      if (filtering.active && filtering.shown.length === 0)
        return <OnlineFilterEmpty filtering={filtering} loaded={tracks.length} />;
      return trackList(filtering.shown, t('search.tracks'));
    }
    const label = t(ONLINE_CATEGORY_LABELS[category]);
    if (category === 'artists')
      return (
        <CoverGrid
          shape={ONLINE_ARTIST_SHAPE}
          keyOf={refKey}
          label={label}
          // 还有下一页时末行会随续页补满，等取完再居中，免得滚到底时末行跳位
          centerTail={kinds.artist.cursor === null}
          items={kinds.artist.items}
          render={(artist) => <OnlineArtistTile artist={artist} {...tileActions(artist)} />}
        />
      );
    if (category === 'albums')
      return (
        <CoverGrid
          shape={STANDARD_GRID_SHAPE}
          keyOf={refKey}
          label={label}
          items={kinds.album.items}
          render={(album) => <OnlineAlbumTile album={album} {...tileActions(album)} />}
        />
      );
    return (
      <CoverGrid
        shape={STANDARD_GRID_SHAPE}
        keyOf={refKey}
        label={label}
        items={kinds.playlist.items}
        render={(playlist) => <OnlinePlaylistTile playlist={playlist} {...tileActions(playlist)} />}
      />
    );
  };

  return (
    <>
      <OnlineControls
        category={category}
        platform={platform}
        options={sourceOptions}
        totals={{
          track: kinds.track.total,
          album: kinds.album.total,
          artist: kinds.artist.total,
          playlist: kinds.playlist.total,
        }}
        measure={measure}
        tier={tier}
        tools={
          category === 'tracks' && (
            <OnlineFilterTools filtering={filtering} surface={surface} labelled={tier === 'wide'} />
          )
        }
        onCategory={choose}
        onSource={chooseSource}
      />
      {category === 'tracks' && (
        <>
          <OnlineFilterSurface filtering={filtering} surface={surface} loaded={tracks.length} />
          <OnlineFilterConditions filtering={filtering} />
        </>
      )}
      {/* 提示放在列表上方：放在列表末尾时，滚得较深就看不到。 */}
      {((ready && failures.length > 0) || notice) && (
        <div className={styles.notices}>
          {ready && failures.length > 0 && (
            <div role="status" className={styles.notice}>
              {t('online.partialFailed', {
                kinds: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                  failedKinds.map((kind) => t(ONLINE_KIND_LABELS[kind])),
                ),
              })}{' '}
              <Button className={viewControls.field} size="small" onClick={reload}>
                {t('album.retry')}
              </Button>
            </div>
          )}
          {notice && (
            <div role="status" className={styles.notice}>
              {t(notice)}
            </div>
          )}
        </div>
      )}
      {headed && (
        <div className={styles.head}>
          <OnlineTrackHeader />
        </div>
      )}
      <div
        ref={setScroller}
        className={styles.scroller}
        tabIndex={-1}
        data-online-results
        data-headed={headed || undefined}
        aria-busy={loading}
      >
        {body()}
        {ready && focusKind && focusState && (
          <OnlineMore
            more={focusState.cursor !== null}
            loadingMore={focusState.loadingMore}
            moreFailed={focusState.moreFailed}
            scroller={scroller}
            // 筛到一首都没有时不一页页往下取，免得为一个落空的条件把整个搜索取光；留着「更多」键由人决定
            auto={!(category === 'tracks' && filtering.active && filtering.shown.length === 0)}
            onMore={() => void search.more(focusKind)}
          />
        )}
      </div>
      <OnlineTrackMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onPlay={(picked) => {
          if (picked.length === 1 && picked[0]) play(picked[0]);
          else
            void player.play(picked, 0, onlineSearchSource(text)).then((ok) => {
              if (!ok) setNotice('songs.playFailed');
            });
        }}
        onQueued={(ok) => setNotice(ok ? null : 'online.queueFailed')}
      />
      <OnlineObjectMenu menu={objectMenu} onClose={closeMenu} onFailed={setNotice} />
    </>
  );
}
