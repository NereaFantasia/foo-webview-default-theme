import { Button, Tooltip, mergeClasses } from '@fluentui/react-components';
import {
  RecordRegular,
  ArrowShuffle16Regular,
  ArrowSync16Regular,
  CalendarLtr16Regular,
  Headphones16Regular,
  MicSparkle16Regular,
  MoreHorizontal16Regular,
  MusicNote216Regular,
  Pause16Regular,
  Play16Regular,
  TextBulletListAddRegular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { pluralAtom, type PluralPick } from '../../i18n/plural.ts';
import type { Translate } from '../../i18n/translate.ts';
import { onlineCoverUrl } from '../../playback/onlineTracks.ts';
import type { MusicListKind, MusicSearchItems } from '../../server/musicProtocol.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import {
  DETAIL_COVER,
  DETAIL_COVER_NARROW,
  DetailCoverFrame,
  DetailHeader,
  useDetailHeaderStyles,
  type DetailChip,
} from '../detail/DetailHeader.tsx';
import { ExpandableText } from '../detail/ExpandableText.tsx';
import { ArtistRow, type ArtistEntry } from '../detail/ArtistRow.tsx';
import { OnlineArtistAvatar } from './OnlineArtistAvatar.tsx';

type Owner = MusicSearchItems[MusicListKind];

const ALBUM_KINDS = {
  album: 'onlineList.kind.album',
  single: 'onlineList.kind.single',
  ep: 'onlineList.kind.ep',
  compilation: 'artistAlbums.kind.compilation',
} as const;

/** 列表本身的封面：专辑与歌单是封面，艺人是头像 */
export function ownerCover(owner: Owner): string | null {
  return 'artwork' in owner ? owner.artwork : 'cover' in owner ? owner.cover : owner.avatar;
}

export const ownerName = (owner: Owner) => ('name' in owner ? owner.name : owner.title);

function chipsOf(
  owner: Owner,
  total: number,
  t: Translate,
  plural: PluralPick,
  locale: string,
): DetailChip[] {
  const tracks = (count: number | null) =>
    count === null ? '' : t(plural(count, 'album.menuTracksOne', 'album.menuTracks'), { count });
  const icon = <TextNumberListLtr16Regular />;
  if ('releaseDate' in owner)
    return [
      { text: owner.kind ? t(ALBUM_KINDS[owner.kind]) : '', icon: <RecordRegular /> },
      { text: owner.releaseDate?.slice(0, 4) ?? '', icon: <CalendarLtr16Regular /> },
      { text: tracks(owner.trackCount ?? total), icon },
    ];
  if ('cover' in owner) {
    const plays =
      owner.playCount === null
        ? ''
        : t('onlineList.plays', {
            count: new Intl.NumberFormat(locale, { notation: 'compact' }).format(owner.playCount),
          });
    return [
      {
        text: t(owner.kind === 'chart' ? 'onlineList.kind.chart' : 'onlineList.kind.playlist'),
        icon: <MusicNote216Regular />,
      },
      { text: tracks(owner.trackCount ?? total), icon },
      owner.kind === 'chart'
        ? { text: owner.updateNote ?? '', icon: <ArrowSync16Regular /> }
        : { text: plays, icon: <Headphones16Regular /> },
    ];
  }
  return [
    { text: t('onlineList.kind.artist'), icon: <MicSparkle16Regular /> },
    {
      text:
        owner.albumCount === null
          ? ''
          : t(plural(owner.albumCount, 'onlineList.albumsOne', 'onlineList.albums'), {
              count: owner.albumCount,
            }),
      icon: <RecordRegular />,
    },
    { text: tracks(owner.trackCount), icon },
  ];
}

export interface OnlineListHeaderProps {
  readonly owner: Owner;
  /** 已取到的曲目数，上游没给首数时写它 */
  readonly loaded: number;
  readonly narrow: boolean;
  /** 正在播的是从这张列表起播的：播放键换成暂停、继续 */
  readonly playing: boolean;
  readonly paused: boolean;
  readonly usable: boolean;
  onPlay(): void;
  onShuffle(): void;
  onQueue(): void;
  onMenu(point: { readonly x: number; readonly y: number }): void;
}

/** 在线列表的页头：照本地专辑详情页的骨架。动作作用于已取到的全部曲目，不受下方查找与排序影响 */
export function OnlineListHeader(props: OnlineListHeaderProps) {
  const { owner, narrow, playing, paused, usable } = props;
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const classes = useDetailHeaderStyles();
  const size = narrow ? DETAIL_COVER_NARROW : DETAIL_COVER;
  const cover = ownerCover(owner);
  const round = 'avatar' in owner;
  const artists = useMemo<ArtistEntry[]>(
    () =>
      'releaseDate' in owner
        ? owner.artists.map((artist, index) => ({
            key: `${index}:${artist.ref?.id ?? artist.name}`,
            name: artist.name,
            to: artist.ref
              ? {
                  kind: 'onlineList',
                  list: { kind: 'artist', ref: artist.ref, title: artist.name },
                }
              : null,
          }))
        : [],
    [owner],
  );
  const subtitle =
    'releaseDate' in owner ? (
      artists.length > 0 && (
        <ArtistRow
          artists={artists}
          renderAvatar={(artist, active) => (
            <OnlineArtistAvatar
              artist={artist.to?.kind === 'onlineList' ? artist.to.list.ref : null}
              active={active}
            />
          )}
        />
      )
    ) : 'cover' in owner && owner.description ? (
      <ExpandableText text={owner.description} />
    ) : undefined;
  return (
    <DetailHeader
      cover={
        <DetailCoverFrame
          size={size}
          round={round}
          src={cover ? onlineCoverUrl(cover, size * (globalThis.devicePixelRatio || 1)) : ''}
        />
      }
      title={ownerName(owner)}
      subtitle={subtitle}
      chips={chipsOf(owner, props.loaded, t, plural, locale)}
      narrow={narrow}
      tabsBelow={round}
      play={
        <>
          <PrimaryPlayButton
            className={classes.action}
            shape="circular"
            icon={playing && !paused ? <Pause16Regular /> : <Play16Regular />}
            disabled={!playing && !usable}
            data-detail-play
            onClick={props.onPlay}
          >
            {playing ? t(paused ? 'album.tileResume' : 'album.tilePause') : t('album.play')}
          </PrimaryPlayButton>
          <Tooltip content={t('albumDetail.shuffle')} relationship="label">
            <Button
              appearance="subtle"
              shape="circular"
              className={mergeClasses(classes.secondary, narrow && classes.icon)}
              icon={<ArrowShuffle16Regular />}
              aria-label={t('albumDetail.shuffle')}
              disabled={!usable}
              data-detail-shuffle
              onClick={props.onShuffle}
            >
              {narrow ? undefined : t('albumDetail.shuffle')}
            </Button>
          </Tooltip>
        </>
      }
      more={
        <>
          <Tooltip content={t('album.enqueue')} relationship="label">
            <Button
              appearance="subtle"
              shape="circular"
              className={mergeClasses(classes.secondary, classes.icon)}
              icon={<TextBulletListAddRegular className={classes.glyph} />}
              aria-label={t('album.enqueue')}
              disabled={!usable}
              data-online-list-queue
              onClick={props.onQueue}
            />
          </Tooltip>
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
                props.onMenu({ x: box.left, y: box.bottom });
              }}
            />
          </Tooltip>
        </>
      }
    />
  );
}
