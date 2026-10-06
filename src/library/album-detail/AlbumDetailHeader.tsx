import {
  Button,
  Link,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tag,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import {
  AddSquare20Regular,
  ArrowShuffle16Regular,
  CalendarLtr16Regular,
  MoreHorizontal16Regular,
  Pulse20Regular,
  Pause16Regular,
  Play16Regular,
  Record48Regular,
  Tag16Regular,
  TextBulletListAddRegular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import { shuffled } from '../../kit/shuffle.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import type { Translate } from '../../i18n/translate.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { durationVar } from '../../motion/timing.ts';
import { albumCoversVersionAtom } from '../albumCovers.ts';
import styles from './AlbumDetailHeader.module.css';
import { formatFactOf, type AlbumFacts, type FormatFact } from './albumDetailFacts.ts';
import { albumMenuAtom, type MenuPoint } from '../albumMenu.ts';
import {
  albumArtistOf,
  albumKeyOf,
  albumYearOf,
  trackPathOf,
  type Album,
} from '../../host/libraryContract.ts';
import { playbackPausedAtom, playingAlbumKeyAtom } from '../playingAlbum.ts';
import { useCoverLoad } from '../../covers/useCoverLoad.ts';
import { useService } from '../../kit/useService.ts';
import { albumSource } from '../albumActions.ts';
import { albumsKey } from '../albumServices.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { trackActionsKey } from '../../track/trackActions.ts';
import { historyKey } from '../../nav/navHistory.ts';

const useStyles = makeStyles({
  chip: {
    maxWidth: '100%',
    minWidth: 0,
    backgroundColor: 'var(--bg-chip)',
    height: '24px',
    paddingLeft: tokens.spacingHorizontalMNudge,
    paddingRight: tokens.spacingHorizontalMNudge,
    color: 'var(--text-secondary)',
    columnGap: tokens.spacingHorizontalSNudge,
  },
  chipIcon: {
    padding: 0,
    width: '12px',
    fontSize: '12px',
    '& svg': { width: '12px', height: '12px' },
  },
  chipText: {
    padding: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  action: {
    height: '40px',
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    paddingRight: tokens.spacingHorizontalXL,
    boxShadow: tokens.shadow2,
    ...shorthands.borderColor(
      `color-mix(in srgb, ${tokens.colorNeutralForeground1} 12%, transparent)`,
    ),
    transitionProperty: 'background-color, color, box-shadow, scale',
    transitionDuration: durationVar('faster'),
    transitionTimingFunction: tokens.curveLinear,
    ':active': { scale: '0.97', boxShadow: 'none' },
  },
  secondary: {
    height: '40px',
    flexShrink: 0,
    fontWeight: tokens.fontWeightRegular,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
    backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 10%, transparent)`,
    ...shorthands.borderColor(
      `color-mix(in srgb, ${tokens.colorNeutralForeground1} 10%, transparent)`,
    ),
    boxShadow: tokens.shadow2,
    transitionProperty: 'background-color, border-color, box-shadow, scale',
    transitionDuration: durationVar('faster'),
    transitionTimingFunction: tokens.curveLinear,
    ':hover': {
      backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 15%, transparent)`,
    },
    ':active': {
      backgroundColor: 'var(--bg-chip)',
      boxShadow: 'none',
      scale: '0.97',
    },
    ':disabled': {
      backgroundColor: tokens.colorNeutralBackgroundDisabled,
      color: tokens.colorNeutralForegroundDisabled,
      boxShadow: 'none',
      scale: '1',
    },
  },
  icon: { width: '40px', minWidth: '40px', padding: 0 },
  glyph: { width: '16px', height: '16px' },
  artist: {
    display: 'block',
    maxWidth: '100%',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase400,
    color: 'var(--accent)',
    ':hover': { color: 'var(--accent-strong)', textDecorationLine: 'none' },
  },
});

/** 头部封面的边长，CSS 像素：宽的时候 350，内容卡窄于 760 时 96。 */
export const DETAIL_COVER = 350;
export const DETAIL_COVER_NARROW = 96;

export interface AlbumDetailHeaderProps {
  readonly album: Album;
  /** 曲目，按碟、曲、标题排；还没到时为空。 */
  readonly tracks: readonly LibraryTrack[];
  /** 格式与碟副标题还没取到时为 null：格式先只写编码，免得先闪一下采样率再换成比特率。 */
  readonly facts: AlbumFacts | null;
  readonly narrow: boolean;
  /** ⋯ 键：作用对象已交给专辑菜单，该在 `point` 处打开了。 */
  readonly onMenu: (point: MenuPoint) => void;
}

function formatText(fact: FormatFact | null, t: Translate): string {
  switch (fact?.kind) {
    case 'lossless':
      return t('albumDetail.formatLossless', {
        codec: fact.codec,
        bits: fact.bits,
        rate: fact.rate,
      });
    case 'lossy':
      return t('albumDetail.formatLossy', { codec: fact.codec, bitrate: fact.bitrate });
    case 'rate':
      return t('albumDetail.formatRate', { codec: fact.codec, rate: fact.rate });
    case 'codec':
      return fact.codec;
    default:
      return '';
  }
}

function DetailCover({ album, size }: { readonly album: Album; readonly size: number }) {
  const albums = useService(albumsKey);
  const covers = albums.covers;
  useAtomValueRawSync(albumCoversVersionAtom);
  const cover = covers.coverOf(album, size);
  const ready = cover?.status === 'ready';
  const image = useCoverLoad(ready ? cover.url : '', (ready && cover.previous) || '', {
    acquire: () => covers.acquire(album),
    settle: (outcome) => covers.settle(album, outcome),
    wait: (retry) => covers.wait(retry),
  });
  return (
    <div className={styles.cover} style={{ width: size, height: size }} data-detail-cover>
      {image.src ? (
        <img
          className={styles.image}
          src={image.src}
          alt=""
          draggable={false}
          onLoad={image.onLoad}
          onError={image.onError}
        />
      ) : (
        <Record48Regular className={styles.placeholder} />
      )}
    </div>
  );
}

/**
 * 「发送到…」：与专辑菜单里那一项同一份清单，外加「新播放列表」。打开时把这张专辑交给专辑菜单的服务，
 * 曲目与目标都从那里取；取到之前各项置灰。
 */
function SendToButton({ album }: { readonly album: Album }) {
  const t = useAtomValueRawSync(translateAtom);
  const menu = useAtomValueRawSync(albumMenuAtom);
  const albums = useService(albumsKey);
  const classes = useStyles();
  // 按专辑键认：库一变，详情页拿到的是清单里新的那一行，对象换了、专辑还是这一张。
  const only = menu.albums.length === 1 ? menu.albums[0] : undefined;
  const mine = !!only && albumKeyOf(only) === albumKeyOf(album) && menu.trackIndex === null;
  const usable = mine && !menu.loading && !menu.failed && menu.tracks.length > 0;
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      onOpenChange={(_, data) => {
        if (data.open) void albums.menu.prepare([album]);
      }}
    >
      <Tooltip content={t('albumDetail.sendTo')} relationship="label">
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            shape="circular"
            className={mergeClasses(classes.secondary, classes.icon)}
            icon={<TextBulletListAddRegular className={classes.glyph} />}
            aria-label={t('albumDetail.sendTo')}
            data-detail-send
          />
        </MenuTrigger>
      </Tooltip>
      <MenuPopover data-detail-send-menu>
        <MenuList>
          {(mine ? menu.targets : []).map((playlist) => (
            <MenuItem
              key={playlist.guid}
              disabled={!usable || playlist.locked}
              onClick={() => void albums.actions.sendTo(playlist)}
            >
              {playlist.name}
            </MenuItem>
          ))}
          {mine && menu.targets.length > 0 && <MenuDivider />}
          <MenuItem
            icon={<AddSquare20Regular />}
            disabled={!usable}
            data-action="send-to-new"
            onClick={() => void albums.actions.sendToNew()}
          >
            {t('albumDetail.newPlaylist')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function AlbumTitle({ name }: { readonly name: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = title.current;
    if (!element) return;
    const fit = () => {
      for (const size of ['hero', 'title1', 'title2']) {
        element.dataset.size = size;
        if (element.scrollWidth <= element.clientWidth) break;
      }
    };
    fit();
    let width = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [name]);
  return (
    <h1 ref={title} className={styles.name} title={name}>
      {name}
    </h1>
  );
}

/** 页头动作始终作用于整张专辑，不受下方查找与排序影响。 */
export function AlbumDetailHeader(props: AlbumDetailHeaderProps) {
  const { album, tracks, facts, narrow } = props;
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const classes = useStyles();
  const albums = useService(albumsKey);
  const trackActions = useService(trackActionsKey);
  const playback = useService(playbackKey);
  const history = useService(historyKey);
  const key = albumKeyOf(album);
  const playing = useAtomValueRawSync(playingAlbumKeyAtom) === key;
  const paused = useAtomValueRawSync(playbackPausedAtom);
  const count = tracks.length || album.trackCount;
  const seconds = tracks.length
    ? tracks.reduce((sum, track) => sum + track.duration, 0)
    : album.duration;
  const format = formatFactOf(tracks[0], facts?.format ?? null);
  const shownFormat = facts || !format ? format : { kind: 'codec' as const, codec: format.codec };
  const duration = t(plural(count, 'album.dropdownFootOne', 'album.dropdownFoot'), {
    count,
    minutes: Math.round(seconds / 60),
  });
  const chips = [
    { text: album.genre, icon: <Tag16Regular /> },
    { text: albumYearOf(album), icon: <CalendarLtr16Regular /> },
    {
      text: t(plural(count, 'album.menuTracksOne', 'album.menuTracks'), { count }),
      icon: <TextNumberListLtr16Regular />,
      tooltip: duration,
    },
    {
      text:
        shownFormat?.kind === 'lossless'
          ? `${shownFormat.codec} ${shownFormat.bits}/${shownFormat.rate}`
          : formatText(shownFormat, t),
      icon: <Pulse20Regular />,
      tooltip: formatText(shownFormat, t),
    },
  ];
  const playLabel = playing ? t(paused ? 'album.tileResume' : 'album.tilePause') : t('album.play');
  const play = () => {
    if (playing) void playback.playOrPause();
    else if (tracks.length > 0)
      void trackActions.playPaths(tracks.map(trackPathOf), 0, albumSource(album));
    else void albums.actions.play(album);
  };

  return (
    <header className={styles.head} data-narrow={narrow || undefined} data-detail-head>
      <DetailCover album={album} size={narrow ? DETAIL_COVER_NARROW : DETAIL_COVER} />
      <div className={styles.identity}>
        <AlbumTitle name={album.name} />
        {albumArtistOf(album) && (
          <Link
            className={classes.artist}
            title={albumArtistOf(album)}
            onClick={() =>
              history.navigate({ id: 'artists', subject: albumArtistOf(album) }, 'drill')
            }
          >
            {albumArtistOf(album)}
          </Link>
        )}
        <div className={styles.facts} data-detail-facts>
          {chips
            .filter((chip) => chip.text !== '')
            .map((chip, index) => (
              <Tooltip key={index} content={chip.tooltip ?? chip.text} relationship="description">
                <Tag
                  size="small"
                  shape="circular"
                  icon={{ children: chip.icon, className: classes.chipIcon }}
                  className={classes.chip}
                  primaryText={{ className: classes.chipText }}
                  tabIndex={0}
                >
                  {chip.text}
                </Tag>
              </Tooltip>
            ))}
        </div>
        <div className={styles.keys}>
          <div className={styles.group}>
            <PrimaryPlayButton
              className={classes.action}
              shape="circular"
              icon={playing && !paused ? <Pause16Regular /> : <Play16Regular />}
              data-detail-play
              onClick={play}
            >
              {playLabel}
            </PrimaryPlayButton>
            <Tooltip content={t('albumDetail.shuffle')} relationship="label">
              <Button
                appearance="subtle"
                shape="circular"
                className={mergeClasses(classes.secondary, narrow && classes.icon)}
                icon={<ArrowShuffle16Regular />}
                aria-label={t('albumDetail.shuffle')}
                disabled={tracks.length === 0}
                data-detail-shuffle
                onClick={() =>
                  void trackActions.playPaths(
                    shuffled(tracks).map(trackPathOf),
                    0,
                    albumSource(album),
                  )
                }
              >
                {narrow ? undefined : t('albumDetail.shuffle')}
              </Button>
            </Tooltip>
          </div>
          <div className={styles.group}>
            <SendToButton album={album} />
            <Tooltip content={t('album.tileMore')} relationship="label">
              <Button
                appearance="subtle"
                shape="circular"
                className={mergeClasses(classes.secondary, classes.icon)}
                icon={<MoreHorizontal16Regular />}
                aria-label={t('album.tileMore')}
                data-detail-more
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  void albums.menu.prepare([album]);
                  props.onMenu({ x: box.left, y: box.bottom });
                }}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </header>
  );
}
