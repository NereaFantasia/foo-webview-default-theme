import { Button, Spinner, Tooltip, mergeClasses } from '@fluentui/react-components';
import { Pause20Filled, Play20Filled, TextBulletListAddRegular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { CoverTheme } from '../../covers/CoverTheme.tsx';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { readOnlineListSubject, type OnlineListSubject } from '../../nav/places.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { musicStatusKey } from '../../playback/musicStatus.ts';
import { onlineListKey, onlineListsKey } from '../../playback/onlineLists.ts';
import { playingOnlineKeyAtom } from '../../playback/playback.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { playbackSourceAtom } from '../../playback/playbackSource.ts';
import type { MusicArtist, MusicTrack } from '../../server/musicObjects.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { ArtistHeroImage } from '../artists/page/ArtistHeroImage.tsx';
import { BiographyPhotoViewer } from '../biography/BiographyPhotoViewer.tsx';
import type { AppleLogo } from '../biography/apple/appleMedia.ts';
import { appleLogoUrl } from '../biography/apple/appleMedia.ts';
import type { LocalAlbum } from '../biography/apple/appleMatch.ts';
import { ArtistHero, useHeroButtonClass } from '../detail/ArtistHero.tsx';
import { FollowHeroKey } from '../detail/FavoriteObjectKeys.tsx';
import { DetailFrame } from '../detail/DetailFrame.tsx';
import { playbackPausedAtom } from '../playingAlbum.ts';
import { useUnblock } from '../search/online/OnlineItems.tsx';
import { OnlineObjectMenu, objectTargetOf } from '../search/online/OnlineObjectMenu.tsx';
import { onlineListSource, onlinePlayKey } from '../search/online/onlinePlay.ts';
import { OnlineTrackMenu } from '../search/online/OnlineTrackMenu.tsx';
import { OnlineArtistAbout } from './OnlineArtistAbout.tsx';
import { OnlineArtistAlbums } from './OnlineArtistAlbums.tsx';
import { OnlineTopTracks } from './OnlineTopTracks.tsx';
import { OnlineFailureView, OnlineNotice } from './OnlineListStatus.tsx';
import { onlineArtistKey } from './onlineArtistBiography.ts';
import { useOnlineArtistBiography } from './onlineArtistBiographyContext.ts';
import { shuffled } from './onlineListRows.ts';
import { useArtistLayout, type ReleaseSection } from './useArtistReleases.ts';
import { useOnlineArtistPortrait } from './useOnlineArtistPortrait.ts';
import styles from './OnlineArtistPage.module.css';

const NO_TRACKS: readonly MusicTrack[] = [];
/** 简介服务还没装配好时照片查看器的顶边，随后换成装配给的值 */
const NO_VIEWER_TOP = atom(48);
const NO_LOGO = atom<AppleLogo | null>(null);
const NO_ENABLED = atom(false);

interface ArtistPageSnapshot {
  readonly top: number;
}
const SLOT = createSnapshotSlot<ArtistPageSnapshot>();

/** 平台给的专辑转成认人用的名单：年份读不出为 null，曲数没给记 0 */
function localAlbumOf(album: {
  readonly title: string;
  readonly releaseDate: string | null;
  readonly trackCount: number | null;
}): LocalAlbum {
  return {
    name: album.title,
    year: Number(album.releaseDate?.slice(0, 4)) || null,
    trackCount: album.trackCount ?? 0,
  };
}

/**
 * 在线艺人页：沿用本地艺人页单栏版式，依次排布头部、专辑、热门歌曲、单曲与 EP、合集、参与及关于
 * 头部先画平台头像，Apple 照片就绪后再行替换；「关于」简介来自 Apple 或 Last.fm
 * 热门歌曲展示平台前 50 首，专辑按发行分节并在超出时引导进入专辑墙页
 */
export function OnlineArtistPage({ list }: { readonly list: OnlineListSubject }) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const heroButton = useHeroButtonClass();
  const lists = useService(onlineListsKey);
  const player = useService(onlinePlayKey);
  const playback = useService(playbackKey);
  const status = useService(musicStatusKey);
  const unblock = useUnblock();
  const bio = useOnlineArtistBiography();
  const state = useAtomValueRawSync(lists.lists).get(onlineListKey(list));
  const playing = useAtomValueRawSync(playingOnlineKeyAtom);
  const source = useAtomValueRawSync(playbackSourceAtom);
  const paused = useAtomValueRawSync(playbackPausedAtom);
  useEffect(() => lists.want(list), [lists, list]);
  useEffect(() => status.refresh(), [status]);

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // 量到宽度之前是 null：头部的高随宽窄变，交还的滚动要等它定下来
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [trackMenu, setTrackMenu] = useState<{
    readonly at: TablePoint;
    readonly tracks: readonly MusicTrack[];
  } | null>(null);
  const [objectMenu, setObjectMenu] = useState<TablePoint | null>(null);
  const [viewing, setViewing] = useState(false);
  const [liveVideo, setLiveVideo] = useState<HTMLVideoElement | null>(null);
  const [restoring, setRestoring] = useState<ArtistPageSnapshot | null>(null);
  const owner: MusicArtist | null = state?.owner && 'avatar' in state.owner ? state.owner : null;
  const items = state?.items ?? NO_TRACKS;
  const ready = state?.phase === 'ready';
  const name = owner?.name ?? list.title;
  const albums = useArtistLayout(list.ref);
  const layout = albums.layout;
  const albumsPhase = albums.state?.phase;
  const portrait = useOnlineArtistPortrait(bio, owner?.avatar ?? null, onlineArtistKey(list.ref));
  // 在线内容开着时「照片」键就占着位置：找的时候转圈，找完换回图标，没有照片则禁用
  const photosOn = useAtomValueRawSync(bio?.enabled ?? NO_ENABLED);
  const viewerTop = useAtomValueRawSync(bio?.viewerTop ?? NO_VIEWER_TOP);
  const logo = useAtomValueRawSync(bio?.logo ?? NO_LOGO);

  // 简介按这位艺人登记，专辑名单交给身份认定用：还没取到传 null，取失败传空表
  useEffect(() => bio?.show(list.ref, name), [bio, list.ref, name]);
  const localAlbums = useMemo<readonly LocalAlbum[] | null>(() => {
    if (albumsPhase === 'failed') return [];
    if (albumsPhase !== 'ready' || !layout) return null;
    return [...layout.albums, ...layout.compilations, ...layout.singles].map(localAlbumOf);
  }, [albumsPhase, layout]);
  useEffect(() => bio?.setAlbums(list.ref, localAlbums), [bio, list.ref, localAlbums]);

  const playedHere = (() => {
    if (!playing || !source || source.kind !== onlineListSource(list).kind) return false;
    const from = readOnlineListSubject(source.subject);
    return from?.ref.platform === list.ref.platform && from.ref.id === list.ref.id;
  })();
  // 起播来源写此刻的名字：进来时带的名字可能是搜索结果里的旧写法
  const start = (tracks: readonly MusicTrack[], index: number) => {
    setNotice(null);
    void player.play(tracks, index, onlineListSource({ ...list, title: name })).then((ok) => {
      if (!ok) setNotice('songs.playFailed');
    });
  };
  const queue = (tracks: readonly MusicTrack[], next: boolean) =>
    void player.queue(tracks, next).then((ok) => setNotice(ok ? null : 'online.queueFailed'));

  usePageSnapshot(
    SLOT,
    {
      capture: () => ({ top: scroller?.scrollTop ?? 0 }),
      restore: (snapshot) => setRestoring(snapshot),
    },
    ready && scroller !== null && narrow !== null,
  );
  // 返回时等热门歌曲与专辑都取到、页高定下来，再恢复滚动
  useLayoutEffect(() => {
    if (!restoring || !ready || !scroller) return;
    if (albumsPhase === undefined || albumsPhase === 'loading') return;
    scroller.scrollTop = restoring.top;
    setRestoring(null);
  }, [restoring, ready, scroller, albumsPhase]);

  const failure = state?.phase === 'failed' ? state.failure : null;
  const retry = () => lists.retry(list);
  const first = useMemo<readonly ReleaseSection[]>(
    () => (layout && layout.albums.length > 0 ? [{ key: 'albums', albums: layout.albums }] : []),
    [layout],
  );
  const rest = useMemo<readonly ReleaseSection[]>(() => {
    if (!layout) return [];
    const all: readonly ReleaseSection[] = [
      { key: 'singles', albums: layout.singles },
      { key: 'compilations', albums: layout.compilations },
      { key: 'featured', albums: layout.featured },
    ];
    return all.filter((section) => section.albums.length > 0);
  }, [layout]);

  const themeUrl = portrait.hero ?? portrait.shown?.url ?? '';
  const albumsState = albums.state;
  const albumsStatus =
    !albumsState || albumsState.phase === 'loading' ? (
      <Spinner className={styles.spinner} aria-label={t('album.loading')} />
    ) : albumsState.phase === 'failed' ? (
      albumsState.failure === 'unsupported' ? null : (
        <OnlineFailureView
          failure={albumsState.failure}
          retry={albums.retry}
          title={t('artistAlbums.failed')}
        />
      )
    ) : null;

  return (
    <CoverTheme url={themeUrl} reuse video={liveVideo}>
      <DetailFrame
        label={name}
        page="onlineList"
        glow={themeUrl !== ''}
        heroReady={!!portrait.hero}
        backdrop={
          portrait.wide ? (
            <ArtistHeroImage
              {...(portrait.hero ? { url: portrait.hero } : {})}
              {...(portrait.heroColor ? { color: portrait.heroColor } : {})}
              {...(portrait.video ? { video: portrait.video } : {})}
              onVideo={setLiveVideo}
            />
          ) : undefined
        }
        intro={
          owner ? (
            <>
              <ArtistHero
                key={`header:${list.ref.id}`}
                name={owner.name}
                {...(logo
                  ? { logo: { src: appleLogoUrl(logo), width: logo.width, height: logo.height } }
                  : {})}
                narrow={narrow === true}
                {...(portrait.shown ? { shown: portrait.shown } : {})}
                wide={portrait.wide}
                loading={portrait.loading}
                canOpenPhotos={portrait.pictures.length > 0}
                photosLoading={portrait.searching}
                {...(photosOn ? { onOpenPhotos: () => setViewing(true) } : {})}
                playable={items.length > 0 || playedHere}
                playLabel={
                  playedHere ? t(paused ? 'album.tileResume' : 'album.tilePause') : t('album.play')
                }
                playIcon={playedHere && !paused ? <Pause20Filled /> : <Play20Filled />}
                onPlay={() => (playedHere ? void playback.playOrPause() : start(items, 0))}
                onShuffle={() => start(shuffled(items), 0)}
                onMenu={(x, y) => setObjectMenu({ x, y })}
                extra={
                  <>
                    <FollowHeroKey
                      artist={owner}
                      labelled={narrow !== true}
                      className={mergeClasses(viewControls.icon, heroButton)}
                    />
                    <Tooltip content={t('album.enqueue')} relationship="label">
                      <Button
                        appearance="transparent"
                        shape="circular"
                        className={mergeClasses(viewControls.icon, heroButton)}
                        icon={<TextBulletListAddRegular />}
                        aria-label={t('album.enqueue')}
                        disabled={items.length === 0}
                        data-online-list-queue
                        onClick={() => queue(items, false)}
                      />
                    </Tooltip>
                  </>
                }
              >
                {bio && portrait.pictures.length > 0 && (
                  <BiographyPhotoViewer
                    open={viewing}
                    artist={owner.name}
                    photos={portrait.pictures}
                    index={0}
                    top={viewerTop}
                    t={t}
                    commandPrefix="onlineArtist"
                    onSelect={() => {}}
                    onClose={() => setViewing(false)}
                  />
                )}
              </ArtistHero>
              {notice && <OnlineNotice notice={notice} onDismiss={() => setNotice(null)} />}
            </>
          ) : failure ? (
            <OnlineFailureView
              failure={failure}
              retry={retry}
              title={t('onlineList.failed.artist')}
              missing={t('onlineList.missing.artist')}
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
                if (only) start(items, items.indexOf(only));
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
        {owner && (
          <div className={styles.sections}>
            {albumsStatus}
            <OnlineArtistAlbums
              key={`albums:${list.ref.id}`}
              sections={first}
              scroller={scroller}
              setNotice={setNotice}
              artist={list.ref}
              name={name}
            />
            <OnlineTopTracks
              key={`songs:${list.ref.id}`}
              tracks={items}
              playing={playing}
              paused={paused}
              unblock={unblock}
              onPlay={(index) => start(items, index)}
              onMenu={(track, at) => setTrackMenu({ at, tracks: [track] })}
            />
            <OnlineArtistAlbums
              key={`rest:${list.ref.id}`}
              sections={rest}
              scroller={scroller}
              setNotice={setNotice}
              artist={list.ref}
              name={name}
            />
            <OnlineArtistAbout owner={owner} bio={bio} />
          </div>
        )}
      </DetailFrame>
    </CoverTheme>
  );
}
