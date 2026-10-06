import {
  mergeClasses,
  Skeleton,
  SkeletonItem,
  TableCell,
  TableRow,
} from '@fluentui/react-components';
import { Fragment, memo, type MouseEvent, type ReactNode } from 'react';
import type { Translate } from '../i18n/translate.ts';
import type { TableServices } from './tableContext.ts';
import { trackDisplayTitle } from '../track/trackDisplayTitle.ts';
import { bitrateText, dayText, durationText, yearText } from './cellText.ts';
import { columnDef, type ColumnId } from './columns/columns.ts';
import { RatingCell } from './RatingCell.tsx';
import type {
  TableArtwork,
  TableLinks,
  TablePoint,
  TableRowItem,
  TableTrack,
} from './tableItems.ts';
import textStyles from './TrackTableRow.module.css';
import { useTrackTableStyles } from './useTrackTableStyles.ts';

/** 这一行与正在播放的关系：不是它、是它但暂停着、是它且正在出声。 */
export type PlayingState = 'none' | 'paused' | 'active';

/** 行的事件，由表格给一份不变的；下标是显示位。 */
export interface RowHandlers {
  click(index: number, event: MouseEvent): void;
  play(index: number): void;
  menu(index: number, point: TablePoint): void;
  rate(track: TableTrack, value: number): void;
}

export interface TrackTableRowProps {
  readonly id: string;
  readonly index: number;
  /** 读屏的行号与层级，见 `ariaRowsOf`。 */
  readonly rowIndex: number;
  readonly level: number;
  readonly item: TableRowItem;
  /** 在行带里的纵坐标，CSS 像素。 */
  readonly top: number;
  readonly cells: readonly ColumnId[];
  /** 第一格在列头里是第几列，从 1 数：有封面列时它占了列头的第 1 列，行里的格子从第 2 列起。 */
  readonly firstColumn: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly playing: PlayingState;
  readonly PlayingMark: TableServices['PlayingMark'];
  readonly rating: number;
  readonly ratable: boolean;
  /** 序号格的写法：只写曲号，或「碟.曲」。 */
  readonly numberText: (track: TableTrack) => string;
  readonly links: TableLinks | undefined;
  readonly artwork: TableArtwork | undefined;
  /** 缩略图边长，CSS 像素。 */
  readonly artSize: number;
  readonly handlers: RowHandlers;
  readonly t: Translate;
}

/**
 * 画成链接的格子。不进 Tab 次序：拿到焦点时表格收回去，键盘照样走行。带修饰键的单击照常交给行去改选中，
 * 不跳转。
 */
function LinkText(props: { readonly value: string; readonly onOpen: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`${textStyles.text} ${textStyles.secondary} ${textStyles.link}`}
      title={props.value}
      onClick={(event) => {
        if (event.ctrlKey || event.shiftKey || event.metaKey) return;
        event.stopPropagation();
        props.onOpen();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {props.value}
    </button>
  );
}

function artistContent(track: TableTrack, open: TableLinks['artist']): ReactNode {
  const values = track.artists?.filter((name) => name.trim().length > 0);
  const names = values?.length ? values : [track.artist];
  return (
    <span
      className={`${textStyles.text} ${textStyles.secondary} ${textStyles['artist-links']}`}
      title={names.join(', ')}
    >
      {names.map((name, index) => (
        <Fragment key={`${index}:${name}`}>
          {index > 0 && ', '}
          {open && name.trim() ? <LinkText value={name} onOpen={() => open(name, track)} /> : name}
        </Fragment>
      ))}
    </span>
  );
}

function content(id: ColumnId, track: TableTrack, props: TrackTableRowProps): ReactNode {
  const { playing, t, PlayingMark } = props;
  const text = (value: string, extra?: string) => (
    <span className={extra ? `${textStyles.text} ${extra}` : textStyles.text} title={value}>
      {value}
    </span>
  );
  switch (id) {
    case 'cover':
      return null;
    case 'art':
      return props.artwork?.(track, props.artSize) ?? null;
    case 'status':
      // 序号列不在时，正在播放的记号挪到这一格。
      if (playing !== 'none' && !props.cells.includes('number')) {
        return <PlayingMark active={playing === 'active'} label={t('table.nowPlaying')} />;
      }
      return null;
    case 'number':
      return playing === 'none' ? (
        props.numberText(track)
      ) : (
        <PlayingMark active={playing === 'active'} label={t('table.nowPlaying')} />
      );
    case 'title':
      return text(trackDisplayTitle(track), textStyles.title);
    case 'artist':
      return artistContent(track, props.links?.artist);
    case 'album': {
      const open = props.links?.album;
      return open && track.album ? (
        <LinkText value={track.album} onOpen={() => open(track)} />
      ) : (
        text(track.album, textStyles.secondary)
      );
    }
    case 'rating':
      return props.ratable ? (
        <RatingCell
          value={props.rating}
          label={t('table.rating')}
          onRate={(value) => props.handlers.rate(track, value)}
        />
      ) : null;
    case 'duration':
      return durationText(track.duration);
    case 'albumArtist':
      return text(track.albumArtist ?? '', textStyles.secondary);
    case 'year':
      return yearText(track.date);
    case 'genre':
      return text(track.genre ?? '', textStyles.secondary);
    case 'added':
      return dayText(track.added);
    case 'playCount':
      return track.playCount === undefined ? '' : String(track.playCount);
    case 'lastPlayed':
      return dayText(track.lastPlayed);
    case 'codec':
      return text(track.codec ?? '', textStyles.secondary);
    case 'bitrate':
      return bitrateText(track.bitrate);
    case 'path':
      return text(track.absolutePath || track.path, textStyles.secondary);
  }
}

/**
 * 表格里的一行曲目：Fluent 的 `TableRow` 与 `TableCell`，各格按列模型给的列排进行的栅格。还没取到曲目时
 * 画骨架。正在播放的那一行在序号格画记号、文字取品牌色；选中使用底色与侧边指示器，不与播放记号混在一起。
 */
export const TrackTableRow = memo(function TrackTableRow(props: TrackTableRowProps) {
  const styles = useTrackTableStyles();
  const { id, index, item, top, cells, selected, focused, playing, handlers } = props;
  const track = item.track;
  return (
    <TableRow
      id={id}
      data-table-item-key={item.key}
      className={mergeClasses(
        styles.row,
        selected && styles.selected,
        playing !== 'none' && styles.playing,
      )}
      style={{ transform: `translateY(${top}px)` }}
      aria-rowindex={props.rowIndex}
      aria-level={props.level}
      aria-selected={selected}
      aria-busy={track === undefined || undefined}
      data-row-focus={focused || undefined}
      onClick={(event) => handlers.click(index, event)}
      onDoubleClick={() => handlers.play(index)}
      onContextMenu={(event) => {
        event.preventDefault();
        handlers.menu(index, { x: event.clientX, y: event.clientY });
      }}
    >
      {cells.map((column, at) => (
        <TableCell
          key={column}
          role="gridcell"
          aria-colindex={props.firstColumn + at}
          data-column-id={column}
          className={mergeClasses(styles.cell, columnDef(column).numeric && styles.numeric)}
        >
          {track ? (
            content(column, track, props)
          ) : (
            <Skeleton className={styles.skeleton} aria-hidden>
              <SkeletonItem size={12} />
            </Skeleton>
          )}
        </TableCell>
      ))}
    </TableRow>
  );
});
