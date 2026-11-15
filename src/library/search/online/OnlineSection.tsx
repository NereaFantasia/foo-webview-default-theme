import { Button } from '@fluentui/react-components';
import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MessageKey } from '../../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { musicStatusKey } from '../../../playback/musicStatus.ts';
import { onlineKey } from '../../../playback/onlineTracks.ts';
import { playingOnlineKeyAtom } from '../../../playback/playback.ts';
import type { MusicTrack } from '../../../server/musicObjects.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { SearchResultList } from '../SearchResultList.tsx';
import { sameSong } from '../searchSuggestions.ts';
import {
  NcmSetupPanel,
  OnlineNoResults,
  OnlineSearchFailed,
  OnlineUnavailable,
} from './OnlineEmpty.tsx';
import { blockedTrack, OnlineTrackRow, useUnblock } from './OnlineItems.tsx';
import { OnlineObjectMenu } from './OnlineObjectMenu.tsx';
import { ONLINE_KIND_LABELS, OnlineOverview } from './OnlineOverview.tsx';
import { onlinePlayKey, onlineSearchSource } from './onlinePlay.ts';
import { searchableKinds, type OnlineCategory, type OnlineSearch } from './onlineSearch.ts';
import { OnlineSourceMenu } from './OnlineSourceMenu.tsx';
import { onlineSourcesKey } from './onlineSources.ts';
import { OnlineTrackMenu } from './OnlineTrackMenu.tsx';
import { useOnlineTileActions } from './useOnlineTileActions.ts';
import styles from './OnlineSection.module.css';

const TRACK_CELL = { width: null, height: 40, stretch: true } as const;
const keyOfTrack = (track: MusicTrack) => track.ref.id;
const playsOnEnter = () => true;

export interface OnlineSectionProps {
  readonly text: string;
  readonly search: OnlineSearch;
  /** 媒体库已取到的曲目：在线曲目里与它们同一首的不出 */
  readonly localTracks: readonly LibraryTrackPartial[];
  /** 外层的滚动区，曲目表按它虚拟化 */
  readonly scroller: HTMLElement | null;
  /** 各节的「查看全部结果」：进那一类的在线音乐范围 */
  onCategory(category: Exclude<OnlineCategory, 'all'>): void;
}

/**
 * 搜索结果「全部」里的在线音乐一区：区标题右端是来源下拉，下面照在线「全部」排艺人、专辑、曲目、歌单各一节，
 * 不出最佳匹配（只出在媒体库那一区）。失败、没下载组件与没有结果的提示只占这一区
 */
export function OnlineSection({
  text,
  search,
  localTracks,
  scroller,
  onCategory,
}: OnlineSectionProps) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const status = useService(musicStatusKey);
  const sources = useService(onlineSourcesKey);
  const sourceOptions = useAtomValueRawSync(sources.options);
  const player = useService(onlinePlayKey);
  const unblock = useUnblock();
  const playing = useAtomValueRawSync(playingOnlineKeyAtom);
  const platform = useAtomValueRawSync(search.platform);
  const kinds = {
    artist: useAtomValueRawSync(search.kinds.artist),
    album: useAtomValueRawSync(search.kinds.album),
    track: useAtomValueRawSync(search.kinds.track),
    playlist: useAtomValueRawSync(search.kinds.playlist),
  };
  const wanted = useMemo(() => searchableKinds(platform), [platform]);
  const reload = useCallback(() => search.load(wanted), [search, wanted]);
  useEffect(() => status.refresh(), [status]);
  useEffect(() => reload(), [reload]);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    readonly at: TablePoint;
    readonly tracks: readonly MusicTrack[];
  } | null>(null);
  const { tileActions, menu: objectMenu, closeMenu } = useOnlineTileActions(setNotice);
  const tracks = useMemo(
    () => kinds.track.items.filter((track) => !localTracks.some((row) => sameSong(row, track))),
    [kinds.track.items, localTracks],
  );
  const play = useCallback(
    (track: MusicTrack) => {
      setNotice(null);
      void player.play(tracks, tracks.indexOf(track), onlineSearchSource(text)).then((ok) => {
        if (!ok) setNotice('songs.playFailed');
      });
    },
    [player, tracks, text],
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

  const states = wanted.map((kind) => kinds[kind]);
  const failures = states.flatMap((state) => (state.status === 'failed' ? [state.failure] : []));
  const pending = wanted.filter(
    (kind) => kinds[kind].status === 'idle' || kinds[kind].status === 'loading',
  );
  const settled = pending.length === 0;
  const empty = settled && states.every((state) => state.items.length === 0);
  const body = () => {
    if (failures.includes('not-installed')) return <NcmSetupPanel onReady={reload} />;
    if (failures.includes('backend-unavailable')) return <OnlineUnavailable onRetry={reload} />;
    if (settled && failures.length === states.length)
      return <OnlineSearchFailed platform={platform} onRetry={reload} />;
    if (empty) return <OnlineNoResults platform={platform} text={text} />;
    return (
      <OnlineOverview
        text={text}
        withBest={false}
        pending={pending}
        artists={kinds.artist.items}
        albums={kinds.album.items}
        tracks={tracks}
        playlists={kinds.playlist.items}
        onChoose={onCategory}
        onPlay={activate}
        tileActions={tileActions}
        renderTracks={(items) => (
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
              label={t('search.tracks')}
              view="online-tracks"
              scroller={scroller}
              active={active}
              onActive={setActive}
              onActivate={activate}
              onMenu={openMenu}
              onAll={async () => items}
            />
          </div>
        )}
      />
    );
  };
  const failedKinds = wanted.filter((kind) => kinds[kind].status === 'failed');
  return (
    <section className={styles.root} data-online-section aria-label={t('online.scopeOnline')}>
      <div className={styles.head}>
        <h2>{t('online.scopeOnline')}</h2>
        {sourceOptions.length > 1 && (
          <OnlineSourceMenu options={sourceOptions} selected={platform} onChoose={sources.choose} />
        )}
      </div>
      {/* 部分类别失败：已取到的照常画，提示放在上面 */}
      {settled && failures.length > 0 && failures.length < states.length && (
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
      {body()}
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
    </section>
  );
}
