import { makeStyles } from '@fluentui/react-components';
import { Play16Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import { onlineListsKey } from '../../playback/onlineLists.ts';
import type { MusicBanner } from '../../server/musicDiscover.ts';
import type { MusicArtistCredit, MusicTrack } from '../../server/musicObjects.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import { musicTrackLinks } from '../../track/trackLinks.ts';
import { OnlineObjectMenu } from '../search/online/OnlineObjectMenu.tsx';
import { onlineListSource, onlinePlayKey } from '../search/online/onlinePlay.ts';
import { useOnlineTileActions } from '../search/online/useOnlineTileActions.ts';
import { useHomeServices } from './homeContext.ts';
import type { RailShape } from './homeRail.ts';
import { HomeRail } from './HomeRail.tsx';
import { HomeRow } from './HomeRow.tsx';
import { Bone } from './HomeSkeleton.tsx';
import { HomeTrackMenu, type HomeTrackMenuState } from './HomeTrackMenu.tsx';
import styles from './HomeBanners.module.css';

const BANNER_SHAPE: RailShape = { min: 300, max: 480, per: 2 };
/** 图上方两行字加图与字的间距，像素；翻页键对着图的中线 */
const BANNER_TEXT = 46;
/** 载入中先占的张数 */
const SKELETONS = 3;

const usePlayStyles = makeStyles({
  button: { width: '36px', height: '36px', minWidth: '36px', padding: 0 },
});

const bannerKey = ({ target }: MusicBanner) =>
  target.kind === 'track' ? `track:${target.track.ref.id}` : `album:${target.album.ref.id}`;

/** 横幅的编辑图：读不到时留空底，不换别的图 */
function BannerArt({ src }: { readonly src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.art}>
      {!failed && (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      )}
      <span className={styles.scrim} aria-hidden />
    </span>
  );
}

/**
 * 平台的编辑横幅：图上已排好作品名与艺人，图上方只写小标题与「作品 · 艺人」。点图或字进专辑页（歌曲横幅进
 * 它所属的专辑），悬停出播放键：歌曲从这一首起播它的专辑，专辑起播整张。读取中先占三张，没有在线内容时整行不出
 */
export function HomeBanners({ rowWidth }: { readonly rowWidth: number }) {
  const t = useAtomValueRawSync(translateAtom);
  const home = useHomeServices();
  const available = useAtomValueRawSync(home.online.available);
  const read = useAtomValueRawSync(home.online.banners);
  const objects = useService(objectOpenerKey);
  const lists = useService(onlineListsKey);
  const player = useService(onlinePlayKey);
  const playStyles = usePlayStyles();
  const { tileActions, menu, closeMenu } = useOnlineTileActions(home.notify);
  const [trackMenu, setTrackMenu] = useState<HomeTrackMenuState | null>(null);
  if (!available || read.status === 'failed') return null;
  if (read.status === 'ready' && !read.items.length) return null;
  const names = (artists: readonly MusicArtistCredit[]) =>
    artists.map((artist) => artist.name).join(t('album.nameSeparator'));

  /** 歌曲横幅起播它所属的专辑，从这一首起；没有专辑或专辑里找不到它时只播这一首 */
  async function playTrack(track: MusicTrack, label: string) {
    home.notify(null);
    const album = track.album?.ref
      ? ({ kind: 'album', ref: track.album.ref, title: track.album.title } as const)
      : null;
    const tracks = album ? await lists.tracks({ kind: 'album', ref: album.ref }) : null;
    const index = tracks?.findIndex((item) => item.ref.id === track.ref.id) ?? -1;
    const ok =
      album && tracks && index >= 0
        ? await player.play(tracks, index, onlineListSource(album))
        : await player.play([track], 0, { kind: 'home', subject: 'banners', name: label });
    if (!ok) home.notify('songs.playFailed');
  }

  const actionsOf = (banner: MusicBanner) => {
    const { target } = banner;
    if (target.kind === 'album') {
      const actions = tileActions(target.album);
      return {
        title: target.album.title,
        artists: names(target.album.artists),
        open: actions.onOpen,
        play: () => actions.onPlay?.(),
        menu: actions.onMenu,
      };
    }
    const album = musicTrackLinks(target.track).album?.ref;
    const play = () => void playTrack(target.track, banner.label);
    return {
      title: target.track.title,
      artists: names(target.track.artists),
      open: album ? () => void objects.open(album) : play,
      play,
      menu: (at: TablePoint) => setTrackMenu({ at, tracks: [target.track], play }),
    };
  };

  const items =
    read.status === 'ready' ? read.items : Array.from({ length: SKELETONS }, () => null);
  return (
    <HomeRow
      section="banners"
      title={t('home.banners')}
      hideTitle
      loading={read.status !== 'ready'}
    >
      <HomeRail
        id="banners"
        label={t('home.banners')}
        rowWidth={rowWidth}
        shape={BANNER_SHAPE}
        items={items.map((banner, index) => ({ banner, index }))}
        keyOf={({ banner, index }) => (banner ? bannerKey(banner) : `skeleton:${index}`)}
        sideArrows={{ at: (width) => BANNER_TEXT + (width * 9) / 16 / 2 }}
        render={({ banner }) => {
          if (!banner)
            return (
              <div className={styles.banner} data-skeleton aria-hidden>
                <span className={styles.label}>
                  <Bone width="40%" height="12px" />
                </span>
                <span className={styles.title}>
                  <Bone width="70%" height="16px" />
                </span>
                <span className={styles.art}>
                  <Bone height="100%" radius="0" />
                </span>
              </div>
            );
          const { title, artists, open, play, menu: openMenu } = actionsOf(banner);
          return (
            <div
              className={styles.banner}
              data-home-item={bannerKey(banner)}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu({ x: event.clientX, y: event.clientY });
              }}
            >
              <button
                type="button"
                className={styles.link}
                aria-label={t('home.bannerLabel', { label: banner.label, title, artists })}
                onClick={open}
              >
                <span className={styles.label}>{banner.label}</span>
                <span className={styles.title} title={`${title} · ${artists}`}>
                  {title}
                  {artists && <span className={styles.by}>{` · ${artists}`}</span>}
                </span>
                <BannerArt src={banner.image} />
              </button>
              <span className={styles.play}>
                <PrimaryPlayButton
                  className={playStyles.button}
                  shape="circular"
                  icon={<Play16Filled />}
                  aria-label={t('home.playItem', { name: title })}
                  onClick={play}
                />
              </span>
            </div>
          );
        }}
      />
      <OnlineObjectMenu menu={menu} onClose={closeMenu} onFailed={home.notify} />
      <HomeTrackMenu opened={trackMenu} onClose={() => setTrackMenu(null)} />
    </HomeRow>
  );
}
