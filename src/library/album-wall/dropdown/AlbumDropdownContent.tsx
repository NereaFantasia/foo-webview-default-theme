import { Button, makeStyles, Spinner } from '@fluentui/react-components';
import {
  ChevronRight20Regular,
  MoreHorizontal20Regular,
  Pause20Filled,
  Play20Filled,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { memo, type AnimationEvent } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { PrimaryPlayButton } from '../../../theme/PrimaryPlayButton.tsx';
import { pluralAtom } from '../../../i18n/plural.ts';
import styles from './AlbumDropdown.module.css';
import { AlbumDropdownTracks } from './AlbumDropdownTracks.tsx';
import { albumDetailPendingAtom } from '../../album-detail/albumDetailOpen.ts';
import { dropdownTracksAtom } from './albumDropdownTracks.ts';
import type { MenuPoint } from '../../albumMenu.ts';
import {
  albumArtistOf,
  albumKeyOf,
  albumYearOf,
  type Album,
} from '../../../host/libraryContract.ts';
import { playbackPausedAtom, playingAlbumKeyAtom } from '../../playingAlbum.ts';
import { AlbumColorTheme } from '../../AlbumColorTheme.tsx';
import { useService } from '../../../kit/useService.ts';
import { albumsKey } from '../../albumServices.ts';
import { playbackKey } from '../../../playback/playbackContract.ts';
import { albumDetailKey } from '../../album-detail/albumDetail.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

const useStyles = makeStyles({ spinner: { alignSelf: 'center' } });

export interface AlbumDropdownContentProps {
  readonly album: Album;
  /** 还在开合或改高：曲目没到时动完了才画骨架行。 */
  readonly moving: boolean;
  /** 同一行点了另一张、等了一阵它的曲目还没到：压暗，头部转圈。 */
  readonly dim: boolean;
  /** 同一行换一张时的进场或退场，朝箭头移动的方向（left / right）；不在换时不给。 */
  readonly enter?: 'left' | 'right';
  readonly leave?: 'left' | 'right';
  readonly onLeft?: () => void;
  /** 专辑菜单的作用对象已经交给菜单服务（这张专辑，或它的一首曲目），该在 `point` 处打开菜单了。 */
  readonly onMenu: (point: MenuPoint) => void;
}

/** 尾注：年份 · 流派 · 首数与分钟 · 格式（曲目到了才知道，几种格式并列）。空的项不写。 */
function footOf(album: Album, codecs: readonly string[], count: (album: Album) => string): string {
  return [albumYearOf(album), album.genre, count(album), codecs.join(' / ')]
    .filter((part) => part !== '')
    .join(' · ');
}

/**
 * 下拉的内容：专辑名与专辑艺术家、播放 / 更多 / 进详情页三枚键、曲目、尾注。这张在播时播放键是暂停
 * 与继续；更多与右键封面是同一份专辑菜单。同一行换一张时新旧两份叠着，各自滑入滑出。窗口变宽变窄时下拉的
 * 外框跟着重排，这里的属性不变、不重新渲染（换内容途中退场的那一份除外）。
 */
export const AlbumDropdownContent = memo(function AlbumDropdownContent(
  props: AlbumDropdownContentProps,
) {
  const { album, onMenu } = props;
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const plural = useAtomValueRawSync(pluralAtom);
  const albums = useService(albumsKey);
  const playback = useService(playbackKey);
  const albumDetail = useService(albumDetailKey);
  const key = albumKeyOf(album);
  const pending = useAtomValueRawSync(albumDetailPendingAtom);
  const opening = pending?.key === key && pending.origin === 'dropdown';
  const tracksState = useAtomValueRawSync(dropdownTracksAtom);
  const tracks = tracksState.tracks.get(key) ?? null;
  const playing = useAtomValueRawSync(playingAlbumKeyAtom) === key;
  const paused = useAtomValueRawSync(playbackPausedAtom);
  const codecs = [...new Set((tracks ?? []).map((track) => track.codec).filter(Boolean))];
  const count = (shown: Album) => {
    const total = tracks?.length ?? shown.trackCount;
    const minutes = Math.round(shown.duration / 60);
    return t(plural(total, 'album.dropdownFootOne', 'album.dropdownFoot'), {
      count: total,
      minutes,
    });
  };
  const playLabel = playing
    ? t(paused ? 'album.tileResume' : 'album.tilePause')
    : t('album.tilePlay');
  const openMenu = (point: MenuPoint) => {
    void albums.menu.prepare([album]);
    onMenu(point);
  };
  const leftOver = (event: AnimationEvent) => {
    if (event.target === event.currentTarget) props.onLeft?.();
  };
  return (
    <AlbumColorTheme album={album}>
      <div
        className={styles.content}
        data-enter={props.enter}
        data-leave={props.leave}
        data-dim={props.dim || undefined}
        aria-hidden={props.leave ? true : undefined}
        onAnimationEnd={leftOver}
      >
        <div className={styles.head}>
          <div className={styles.titles}>
            <span className={styles.name} title={album.name}>
              {album.name}
            </span>
            <span className={styles.artist} title={albumArtistOf(album)}>
              {albumArtistOf(album)}
            </span>
          </div>
          {props.dim && <Spinner size="tiny" className={classes.spinner} />}
          <div className={styles.keys}>
            <PrimaryPlayButton
              shape="circular"
              size="large"
              icon={playing && !paused ? <Pause20Filled /> : <Play20Filled />}
              aria-label={playLabel}
              data-dropdown-play
              onClick={() => void (playing ? playback.playOrPause() : albums.actions.play(album))}
            />
            <Button
              appearance="subtle"
              className={controls.icon}
              shape="circular"
              size="large"
              icon={<MoreHorizontal20Regular />}
              aria-label={t('album.tileMore')}
              data-dropdown-more
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                openMenu({ x: box.left, y: box.bottom });
              }}
            />
            <Button
              appearance="subtle"
              className={controls.icon}
              shape="circular"
              size="large"
              icon={opening ? <Spinner size="extra-tiny" /> : <ChevronRight20Regular />}
              aria-label={t('album.openDetail')}
              aria-busy={opening || undefined}
              data-dropdown-detail
              onClick={() => albumDetail.open(album, 'dropdown')}
            />
          </div>
        </div>
        <AlbumDropdownTracks
          key={key}
          album={album}
          tracks={tracks}
          failed={tracksState.failed.has(key)}
          skeleton={!props.moving}
          onPlay={(index) => void albums.actions.play(album, index)}
          onMenu={(selected, index, point, ratingStamp) => {
            void albums.menu.prepareTracks(album, selected, index, ratingStamp);
            onMenu(point);
          }}
        />
        <span className={styles.foot}>{footOf(album, codecs, count)}</span>
      </div>
    </AlbumColorTheme>
  );
});
