import {
  MoreHorizontal16Regular,
  MusicNote2Regular,
  Play16Filled,
  ReOrderDotsVertical16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { titleOf } from '../RightCardHead.tsx';
import { QueueRating } from './QueueRating.tsx';
import styles from './QueueRow.module.css';
import type { UpNextTrack } from './upNext.ts';
import { useQueueCover } from './useQueueCover.ts';

/** 菜单与键盘开菜单的落点，视口坐标。 */
export interface RowPoint {
  readonly x: number;
  readonly y: number;
}

export interface QueueRowProps {
  /**
   * `queued` 是手动加的那一段，能拖；`upnext` 是来源里接下来的，`earlier` 是正在播的这一首前面那几行，
   * 都不能拖。
   */
  readonly kind: 'queued' | 'upnext' | 'earlier' | 'review';
  readonly rowKey: string;
  /** 显示序号：接下来与前面那几行用来源列表的位置；手动队列和回看各自从 1 起。 */
  readonly number: number;
  readonly track: UpNextTrack;
  readonly selected: boolean;
  /** 键盘焦点停在这一行：它是列表里唯一能 Tab 进来的一行。 */
  readonly current: boolean;
  /** 正被拖着：原位变淡。 */
  readonly lifted: boolean;
  readonly openAlbum: (() => void) | null;
  onPointerDown(event: PointerEvent<HTMLDivElement>, key: string): void;
  onPlay(key: string): void;
  onMenu(key: string, at: RowPoint): void;
  onFocus(key: string): void;
}

/** 时长写成 m:ss，过一小时写 h:mm:ss；不知道时长（流）不写。 */
export function formatLength(seconds: number): string {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const s = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`;
}

/** 封面；没有地址或加载出错时画占位图标。 */
function RowCover({ url }: { readonly url: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = url && failed !== url ? url : null;
  return shown ? (
    <img src={shown} alt="" draggable={false} loading="lazy" onError={() => setFailed(shown)} />
  ) : (
    <MusicNote2Regular />
  );
}

/**
 * 队列页的一行，高 48。左槽显示序号，「队列」段悬停时换成拖拽手柄；封面 36，悬停时压暗、
 * 出播放键；标题行右端悬停时出五颗星，标题在星前截断；副标题写「艺术家 · 专辑」，专辑名是去专辑详情页的
 * 链接；右槽平时写时长，悬停时换成 ⋯。单击选中，双击与封面上的播放键立即播放。
 *
 * 行里的键都不进 Tab 顺序：键盘用户在行上按 Enter 播放、按菜单键开菜单，菜单里有同样的几样。
 */
export function QueueRow(props: QueueRowProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { kind, rowKey, track } = props;
  const coverElement = useRef<HTMLSpanElement>(null);
  const cover = useQueueCover(track.handle || track.path, false, coverElement);
  const title = titleOf(track);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const menuAt = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    props.onMenu(rowKey, { x: event.clientX, y: event.clientY });
  };
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div
      id={`queue-row-${rowKey}`}
      className={styles.row}
      role="option"
      aria-selected={props.selected}
      tabIndex={props.current ? 0 : -1}
      data-queue-row={rowKey}
      data-kind={kind}
      data-track-handle={track.handle}
      data-selected={props.selected || undefined}
      data-lifted={props.lifted || undefined}
      onPointerDown={(event) => props.onPointerDown(event, rowKey)}
      onDoubleClick={() => props.onPlay(rowKey)}
      onContextMenu={menuAt}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!(
          event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
        ))
          setFocused(false);
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) props.onFocus(rowKey);
      }}
    >
      <span className={styles.lead}>
        <span className={styles.number}>{props.number}</span>
        {kind === 'queued' && (
          <span className={styles.handle} title={t('queue.drag')} data-queue-handle>
            <ReOrderDotsVertical16Regular />
          </span>
        )}
      </span>
      <span ref={coverElement} className={styles.cover}>
        <RowCover url={cover} />
        <button
          type="button"
          className={styles.play}
          tabIndex={-1}
          aria-label={t('queue.playTrack', { title })}
          onPointerDown={stop}
          onDoubleClick={stop}
          onClick={(event) => {
            event.stopPropagation();
            props.onPlay(rowKey);
          }}
        >
          <Play16Filled />
        </button>
      </span>
      <span className={styles.identity}>
        <span className={styles.titleLine}>
          <span className={styles.title}>{title}</span>
          {(hovered || focused) && (
            <span className={styles.rating}>
              <QueueRating track={track} />
            </span>
          )}
        </span>
        <span className={styles.subtitle}>
          {track.artist}
          {track.artist && track.album && ' · '}
          {track.album &&
            (props.openAlbum ? (
              <button
                type="button"
                className={styles.link}
                tabIndex={-1}
                aria-label={t('queue.goToAlbum', { album: track.album })}
                onPointerDown={stop}
                onDoubleClick={stop}
                onClick={(event) => {
                  event.stopPropagation();
                  props.openAlbum?.();
                }}
              >
                {track.album}
              </button>
            ) : (
              track.album
            ))}
        </span>
      </span>
      <span className={styles.tail}>
        <span className={styles.length}>{formatLength(track.duration)}</span>
        <button
          type="button"
          className={styles.more}
          tabIndex={-1}
          aria-label={t('queue.more')}
          onPointerDown={stop}
          onDoubleClick={stop}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            event.stopPropagation();
            props.onMenu(rowKey, { x: box.left, y: box.bottom });
          }}
        >
          <MoreHorizontal16Regular />
        </button>
      </span>
    </div>
  );
}

/** 拖动副本不包含按钮、焦点或列表身份，避免重复参与选择和命令。 */
export function QueueRowPreview({ track }: { readonly track: UpNextTrack }) {
  const cover = useQueueCover(track.handle || track.path, false);
  return (
    <div className={styles.row} data-preview>
      <span className={styles.lead}>
        <span className={styles.handle}>
          <ReOrderDotsVertical16Regular />
        </span>
      </span>
      <span className={styles.cover}>
        <RowCover url={cover} />
      </span>
      <span className={styles.identity}>
        <span className={styles.titleLine}>
          <span className={styles.title}>{titleOf(track)}</span>
        </span>
        <span className={styles.subtitle}>
          {track.artist}
          {track.artist && track.album && ' · '}
          {track.album}
        </span>
      </span>
      <span className={styles.tail}>
        <span className={styles.length}>{formatLength(track.duration)}</span>
      </span>
    </div>
  );
}
