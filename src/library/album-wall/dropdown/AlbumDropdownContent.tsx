import { Button, makeStyles, Spinner } from '@fluentui/react-components';
import {
  ChevronRight20Regular,
  MoreHorizontal20Regular,
  Pause20Filled,
  Play20Filled,
  CalendarLtr16Regular,
  Clock16Regular,
  Pulse20Regular,
  Tag16Regular,
  TextNumberListLtr16Regular,
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
import { Metadata, MetadataItem } from '../../../kit/Metadata.tsx';
import { durationText } from '../../../table/cellText.ts';
import { ObjectLink } from '../../../nav/ObjectLink.tsx';
import { albumArtistLink } from '../../../track/trackLinks.ts';

const useStyles = makeStyles({ spinner: { alignSelf: 'center' } });

export interface AlbumDropdownContentProps {
  readonly album: Album;
  /** 展开动画过渡中状态（动效完成前暂缓展示骨架屏） */
  readonly moving: boolean;
  /** 异步加载遮罩态：同排切换专辑等待曲目期间压暗并呈现加载指示器 */
  readonly dim: boolean;
  /** 同排切换专辑时的滑入或滑出过渡方向 */
  readonly enter?: 'left' | 'right';
  readonly leave?: 'left' | 'right';
  readonly onLeft?: () => void;
  /** 触发专辑或曲目快捷操作菜单回调 */
  readonly onMenu: (point: MenuPoint) => void;
}

/**
 * 专辑墙内嵌下拉面板内容区
 *
 * 展示专辑元数据、快捷操作键（播放/暂停、更多操作、详情跳转）、曲目列表与汇总信息；
 * 同排切换时新旧内容执行同向平滑滑动转场；视口重排期间保持内容实例稳定
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
  const total = tracks?.length ?? album.trackCount;
  const year = albumYearOf(album);
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
              <ObjectLink to={albumArtistLink(album)?.ref ?? null}>
                {albumArtistOf(album)}
              </ObjectLink>
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
        <Metadata className={styles.foot}>
          {year && (
            <MetadataItem icon={<CalendarLtr16Regular />} label={t('table.year')}>
              {year}
            </MetadataItem>
          )}
          {album.genre && (
            <MetadataItem icon={<Tag16Regular />} label={t('table.genre')} title={album.genre}>
              {album.genre}
            </MetadataItem>
          )}
          <MetadataItem icon={<TextNumberListLtr16Regular />}>
            {t(plural(total, 'album.menuTracksOne', 'album.menuTracks'), { count: total })}
          </MetadataItem>
          {album.duration > 0 && (
            <MetadataItem icon={<Clock16Regular />} label={t('table.duration')}>
              {durationText(album.duration)}
            </MetadataItem>
          )}
          {codecs.map((codec) => (
            <MetadataItem key={codec} icon={<Pulse20Regular />} label={t('trackInfo.codec')}>
              {codec}
            </MetadataItem>
          ))}
        </Metadata>
      </div>
    </AlbumColorTheme>
  );
});
