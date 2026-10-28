import { Tooltip } from '@fluentui/react-components';
import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  MoreHorizontal16Regular,
  Person48Regular,
  PuzzlePiece16Regular,
  Record48Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { memo, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { MessageKey } from '../../../i18n/en.ts';
import { FadeImage } from '../../../kit/FadeImage.tsx';
import { useService } from '../../../kit/useService.ts';
import { musicStatusKey } from '../../../playback/musicStatus.ts';
import { durationText } from '../../../table/cellText.ts';
import {
  MUSIC_QUALITIES,
  type MusicQuality,
  type MusicTrack,
} from '../../../server/musicObjects.ts';
import { PlayingMark } from '../../../track/PlayingMark.tsx';
import { LinkedAlbum, LinkedArtists } from '../../../track/TrackCredits.tsx';
import { TrackMetadata } from '../../../track/TrackMetadata.tsx';
import { musicTrackLinks } from '../../../track/trackLinks.ts';
import { onlineCoverUrl } from '../../../playback/onlineTracks.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import type { SearchListItemProps } from '../SearchResultList.tsx';
import styles from './OnlineItems.module.css';

function Cover({
  src,
  size,
  round = false,
}: {
  readonly src: string | null;
  readonly size: number;
  readonly round?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const Placeholder = round ? Person48Regular : Record48Regular;
  return (
    <span
      className={styles.cover}
      data-round={round || undefined}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src && failed !== src ? (
        <FadeImage
          className={styles.image}
          src={onlineCoverUrl(src, size * (globalThis.devicePixelRatio || 1))}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(src)}
        />
      ) : (
        <Placeholder className={styles.placeholder} />
      )}
    </span>
  );
}

const QUALITY_LABELS: Readonly<Record<MusicQuality, MessageKey>> = {
  '128k': 'online.quality.128k',
  '320k': 'online.quality.320k',
  flac: 'online.quality.flac',
  flac24bit: 'online.quality.flac24bit',
};

/** 曲目本身提供的最高一档；上游没列档位时为 null */
export function bestQuality(track: MusicTrack): MusicQuality | null {
  return (
    [...MUSIC_QUALITIES].reverse().find((quality) => track.qualities.includes(quality)) ?? null
  );
}

const ACCESS_LABELS = {
  vip: 'online.vip',
  purchase: 'online.purchase',
  unavailable: 'online.unavailable',
} as const satisfies Partial<Record<NonNullable<MusicTrack['access']>, MessageKey>>;

export const artistNames = (track: Pick<MusicTrack, 'artists'>) =>
  track.artists.map((artist) => artist.name).join(', ');

/** 「用第三方来源补全无法播放的曲目」开着没有；还没读到时为 null */
export function useUnblock(): boolean | null {
  const status = useService(musicStatusKey);
  const read = useAtomValueRawSync(status.state);
  return read.status === 'ready' ? read.music.unblock : null;
}

/**
 * 网易云无版权、补全又关着：取不到地址，行变淡，双击与回车不起播。补全开没开还没读到时不拦，
 * 放不出来时 fb2k 会跳过并提示原因
 */
export const blockedTrack = (track: Pick<MusicTrack, 'access'>, unblock: boolean | null) =>
  track.access === 'unavailable' && unblock === false;

export type OnlineColumn =
  'number' | 'cover' | 'title' | 'artist' | 'album' | 'quality' | 'duration' | 'menu';

/**
 * 曲目表的几种列：搜索结果不带序号；在线列表带序号与行尾的 ⋯，专辑那一种不出封面与专辑两列。列宽写在样式里，
 * 按 `data-layout` 取
 */
export const ONLINE_TRACK_LAYOUTS = {
  search: ['cover', 'title', 'artist', 'album', 'quality', 'duration'],
  list: ['number', 'cover', 'title', 'artist', 'album', 'quality', 'duration', 'menu'],
  album: ['number', 'title', 'artist', 'quality', 'duration', 'menu'],
} as const satisfies Record<string, readonly OnlineColumn[]>;
export type OnlineTrackLayout = keyof typeof ONLINE_TRACK_LAYOUTS;

const COLUMN_CLASSES: Partial<Record<OnlineColumn, string>> = {
  number: styles.number,
  album: styles.album,
  quality: styles.quality,
  duration: styles.duration,
};
/** 有字的列头；在线列表页的排序字段也照它写 */
export const ONLINE_COLUMN_LABELS = {
  title: 'table.title',
  artist: 'table.artist',
  album: 'table.album',
  quality: 'online.quality',
  duration: 'table.duration',
} as const satisfies Partial<Record<OnlineColumn, MessageKey>>;
const COLUMN_LABELS: Partial<Record<OnlineColumn, MessageKey>> = ONLINE_COLUMN_LABELS;

export interface OnlineTrackSort {
  /** `number` 是列表本来的顺序 */
  readonly column: OnlineColumn;
  readonly descending: boolean;
}

/**
 * 曲目表的列头，列宽与 `OnlineTrackRow` 同一套网格。给了 `onSort` 时有字的列头是按钮，点了按这一列排，
 * 正在按它排的列头带方向箭头；序号列写 #，读屏念 `orderLabel`
 */
export function OnlineTrackHeader({
  layout = 'search',
  sort = null,
  orderLabel = '',
  onSort,
}: {
  readonly layout?: OnlineTrackLayout;
  readonly sort?: OnlineTrackSort | null;
  readonly orderLabel?: string;
  onSort?(column: OnlineColumn): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const Arrow = sort?.descending ? ArrowDown16Regular : ArrowUp16Regular;
  return (
    <div className={styles.header} data-layout={layout} aria-hidden={onSort ? undefined : true}>
      {ONLINE_TRACK_LAYOUTS[layout].map((column) => {
        const key = COLUMN_LABELS[column];
        const label = column === 'number' ? orderLabel : key ? t(key) : '';
        const text = column === 'number' ? '#' : label;
        const className = COLUMN_CLASSES[column] ?? '';
        if (!text) return <span key={column} />;
        if (!onSort)
          return (
            <span key={column} className={className}>
              {text}
            </span>
          );
        return (
          <button
            key={column}
            type="button"
            className={`${styles.sortable} ${className}`}
            aria-label={label}
            data-online-sort={column}
            data-active={sort?.column === column || undefined}
            onClick={() => onSort(column)}
          >
            {text}
            {sort?.column === column && <Arrow className={styles.arrow} />}
          </button>
        );
      })}
    </div>
  );
}

export interface OnlineTrackRowProps extends SearchListItemProps<MusicTrack> {
  readonly track: MusicTrack;
  /** 正在播的就是这一首 */
  readonly playing: boolean;
  /** 补全开着没有，见 `useUnblock`：关着时无版权的行变淡，开着时它的标记换成补全图标 */
  readonly unblock: boolean | null;
  readonly layout?: OnlineTrackLayout;
  /** 序号格里的字；正在播的那一行改画正在播放的记号 */
  readonly number?: string;
  /** 正在播的这一首暂停着：记号静止 */
  readonly paused?: boolean;
}

export const OnlineTrackRow = memo(function OnlineTrackRow({
  track,
  playing,
  unblock,
  id,
  selected,
  focused,
  position,
  total,
  onActivate,
  onSelect,
  onMenu,
  layout = 'search',
  number = '',
  paused = false,
}: OnlineTrackRowProps) {
  const t = useAtomValueRawSync(translateAtom);
  const quality = bestQuality(track);
  const dimmed = blockedTrack(track, unblock);
  const unblocked = track.access === 'unavailable' && unblock === true;
  const access =
    track.access && track.access !== 'free' && !unblocked ? ACCESS_LABELS[track.access] : null;
  const artists = artistNames(track);
  const links = useMemo(() => musicTrackLinks(track), [track]);
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-posinset={position}
      aria-setsize={total}
      className={styles.row}
      data-layout={layout}
      data-online-track={track.ref.id}
      data-selected={selected || undefined}
      data-focused={focused || undefined}
      data-playing={playing || undefined}
      data-dimmed={dimmed || undefined}
      title={[track.title, artists, track.album?.title, dimmed && t('online.blockedHint')]
        .filter(Boolean)
        .join('\n')}
      onPointerDown={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.detail < 2)
          onSelect(track, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
      }}
      onDoubleClick={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onActivate(track, true);
      }}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        onMenu(track, { x: event.clientX, y: event.clientY });
      }}
    >
      {ONLINE_TRACK_LAYOUTS[layout].map((column) => {
        switch (column) {
          case 'number':
            return (
              <span key={column} className={styles.number}>
                {playing ? <PlayingMark active={!paused} label={t('table.nowPlaying')} /> : number}
              </span>
            );
          case 'cover':
            return <Cover key={column} src={track.artwork} size={32} />;
          case 'title':
            return (
              <span key={column} className={styles.title}>
                <span className={styles.text}>{track.title}</span>
                {access && <span className={styles.badge}>{t(access)}</span>}
                {unblocked && (
                  <Tooltip content={t('online.unblockedHint')} relationship="description">
                    <span
                      className={styles.unblocked}
                      role="img"
                      aria-label={t('online.unblockedLabel')}
                      data-online-unblocked
                    >
                      <PuzzlePiece16Regular />
                    </span>
                  </Tooltip>
                )}
              </span>
            );
          case 'artist':
            return (
              <LinkedArtists
                key={column}
                artists={links.artists}
                className={styles.text}
                tabIndex={-1}
              />
            );
          case 'album':
            return links.album ? (
              <LinkedAlbum
                key={column}
                album={links.album}
                className={`${styles.text} ${styles.album}`}
                tabIndex={-1}
              />
            ) : (
              <span key={column} className={`${styles.text} ${styles.album}`}>
                —
              </span>
            );
          case 'quality':
            return (
              <span key={column} className={styles.quality}>
                {quality ? t(QUALITY_LABELS[quality]) : ''}
              </span>
            );
          case 'duration':
            return (
              <span key={column} className={styles.duration}>
                {track.durationMs === null ? '' : durationText(track.durationMs / 1000)}
              </span>
            );
          case 'menu':
            return (
              <button
                key={column}
                type="button"
                tabIndex={-1}
                className={styles.more}
                aria-label={t('album.tileMore')}
                data-online-row-more
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  const box = event.currentTarget.getBoundingClientRect();
                  onMenu(track, { x: box.left, y: box.bottom });
                }}
              >
                <MoreHorizontal16Regular />
              </button>
            );
        }
      })}
    </div>
  );
});

/** 右键在指针处开菜单：图块与最佳匹配行共用 */
export function menuAt(event: MouseEvent, onMenu: (at: TablePoint) => void) {
  event.preventDefault();
  onMenu({ x: event.clientX, y: event.clientY });
}

/** 最佳匹配那一行：左图、名字，下面一行是种类与字段。单击时曲目起播，艺人与专辑打开在线列表页 */
export function OnlineBestRow({
  cover,
  round,
  title,
  children,
  onActivate,
  onMenu,
}: {
  readonly cover: string | null;
  readonly round: boolean;
  readonly title: string;
  readonly children: ReactNode;
  onActivate(): void;
  onMenu?(at: TablePoint): void;
}) {
  return (
    <button
      type="button"
      className={styles.best}
      data-online-best
      onClick={onActivate}
      onContextMenu={onMenu && ((event) => menuAt(event, onMenu))}
    >
      <Cover src={cover} size={40} round={round} />
      <span className={styles.bestLabels}>
        <span className={styles.bestTitle}>{title}</span>
        <span className={styles.bestFields}>{children}</span>
      </span>
    </button>
  );
}

/** 搜索下拉里的一首在线曲目：与本地结果行同高，左图 40，下面一行是艺人与专辑，右边是时长 */
export function OnlineSuggestionRow({
  track,
  id,
  selected,
  onOpen,
  onMenu,
}: {
  readonly track: MusicTrack;
  readonly id: string;
  readonly selected: boolean;
  onOpen(): void;
  onMenu(at: TablePoint): void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className={styles.suggestion}
      data-online-suggestion={track.ref.id}
      data-selected={selected || undefined}
      title={[track.title, artistNames(track), track.album?.title].filter(Boolean).join('\n')}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <Cover src={track.artwork} size={40} />
      <span className={styles.bestLabels}>
        <span className={styles.bestTitle}>{track.title}</span>
        <TrackMetadata
          className={styles.bestFields}
          artist={artistNames(track)}
          album={track.album?.title ?? ''}
        />
      </span>
      <span className={styles.tail}>
        {track.durationMs === null ? '' : durationText(track.durationMs / 1000)}
      </span>
    </div>
  );
}
