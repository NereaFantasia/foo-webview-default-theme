import { Spinner } from '@fluentui/react-components';
import { Checkmark12Filled, Record48Regular } from '@fluentui/react-icons';
import {
  memo,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { PlayingMark } from '../../track/PlayingMark.tsx';
import styles from './AlbumTile.module.css';
import type { AlbumCover } from '../albumCovers.ts';
import type { GridPosition } from './albumGridKeys.ts';
import type { MenuPoint } from '../albumMenu.ts';
import { albumArtistOf, type Album } from '../../host/libraryContract.ts';
import type { CoverOutcome } from '../../covers/coverGate.ts';
import type { Modifiers } from '../../kit/keyedSelection.ts';
import { useCoverLoad } from '../../covers/useCoverLoad.ts';
import { REFLOW_KEY_ATTR, tileReflowKey } from './wallReflow.ts';

/**
 * 图块往上报的动作。整张网格共用一份、引用不变，图块才能按属性跳过重渲染；落点按「条目 + 列」给，
 * 同一张专辑在几节里各有一块时认得出点的是哪一块。
 */
export interface TileHandlers {
  select(album: Album, at: GridPosition, modifiers: Modifiers): void;
  /** 单击开合这张的下拉。 */
  toggle(album: Album, at: GridPosition): void;
  play(album: Album): void;
  menu(album: Album, at: GridPosition, point: MenuPoint): void;
  press(album: Album, at: GridPosition, event: PointerEvent): void;
  dragStart(album: Album, at: GridPosition, event: DragEvent): void;
  acquire(album: Album): boolean;
  settle(album: Album, outcome: CoverOutcome): void;
  wait(retry: () => void): () => void;
}

export interface AlbumTileProps {
  readonly id: string;
  /** 渲染键（`PlacedTile.key`）；网格按它认指针停在哪一块上。 */
  readonly tileKey: string;
  readonly album: Album;
  readonly index: number;
  /** 行里第几块；横坐标由它与网格给的起点、列距在样式里算。 */
  readonly column: number;
  /** 在行层里的上沿，CSS 像素。 */
  readonly y: number;
  readonly cover: AlbumCover | undefined;
  readonly selected: boolean;
  /** 多选里的一张：左上角出勾。只选中一张时不画。 */
  readonly checked: boolean;
  readonly focused: boolean;
  readonly playing: boolean;
  /** 正在播放的这张正在出声（没暂停）：记号的竖条跳动。别的图块恒为假，播放与暂停切换时它们不重渲染。 */
  readonly audible: boolean;
  /** 从这一块的专辑菜单进详情页、曲目等得有一阵了：封面上出小转圈。从下拉的 › 进时转圈出在那枚键上。 */
  readonly opening: boolean;
  /** 指针停在这一块上：正在播放的记号让位给悬停的「更多」键。 */
  readonly hovered: boolean;
  readonly showText: boolean;
  /** 跟哪一组平移：上面正在开合的下拉有几条，0 是不动（见 `foldGroups`）。 */
  readonly fold: number;
  readonly handlers: TileHandlers;
}

/** 图块样式里按列号与上沿定位（`AlbumTile.module.css` 的 `.tile`）。 */
function placeOf(column: number, y: number): CSSProperties & Record<`--${string}`, string> {
  return { '--tile-column': String(column), '--tile-y': `${y}px` };
}

/** Ctrl 与 Command 同算：键盘那一侧也是这样认的。 */
function modifiersOf(event: MouseEvent): Modifiers {
  return { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey };
}

/**
 * 一块专辑：正方形封面加两行字。`cover` 为 undefined 是还没取地址或这张凉着，缺图与出错也画占位盘片。
 * 要画封面时经 `useCoverLoad` 向封面服务要名额，拿到了才挂 `<img>`，有了结局再报回，名额因此总能
 * 还回去。悬停的播放与更多两枚键不在图块里，整张网格只挂一对（`AlbumTileKeys`）。
 */
export const AlbumTile = memo(function AlbumTile(props: AlbumTileProps) {
  const { album, handlers, cover } = props;
  const at = { index: props.index, column: props.column };
  const ready = cover?.status === 'ready';
  const image = useCoverLoad(ready ? cover.url : '', (ready && cover.previous) || '', {
    acquire: () => handlers.acquire(album),
    settle: (outcome) => handlers.settle(album, outcome),
    wait: (retry) => handlers.wait(retry),
  });
  const artist = albumArtistOf(album);
  return (
    <div
      id={props.id}
      className={styles.tile}
      role="gridcell"
      aria-selected={props.selected}
      aria-rowindex={props.index + 1}
      aria-colindex={props.column + 1}
      data-album-tile
      data-tile-key={props.tileKey}
      {...{ [REFLOW_KEY_ATTR]: tileReflowKey(props.tileKey) }}
      data-focused={props.focused || undefined}
      data-playing={props.playing || undefined}
      data-fold={props.fold || undefined}
      draggable
      style={placeOf(props.column, props.y)}
      onClick={(event) => {
        const modifiers = modifiersOf(event);
        handlers.select(album, at, modifiers);
        // 单击开合下拉：双击的第二下不算，带修饰键的只改选中。
        const plain = !modifiers.ctrl && !modifiers.shift && !event.altKey;
        if (plain && event.detail <= 1) handlers.toggle(album, at);
      }}
      onDoubleClick={() => handlers.play(album)}
      onContextMenu={(event) => {
        event.preventDefault();
        handlers.menu(album, at, { x: event.clientX, y: event.clientY });
      }}
      onPointerDown={(event) => handlers.press(album, at, event)}
      onDragStart={(event) => handlers.dragStart(album, at, event)}
    >
      <div className={styles.art}>
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
        {props.playing && !props.hovered && (
          <span className={styles.playing} aria-hidden>
            <PlayingMark active={props.audible} className={styles['playing-mark']} />
          </span>
        )}
        {props.checked && (
          <span className={styles.check} aria-hidden data-tile-check>
            <Checkmark12Filled />
          </span>
        )}
        {props.opening && (
          <span className={styles.opening} data-tile-opening>
            <Spinner size="small" />
          </span>
        )}
      </div>
      {props.showText && (
        <>
          <span className={styles.name} title={album.name}>
            {album.name}
          </span>
          <span className={styles.artist} title={artist}>
            {artist}
          </span>
        </>
      )}
    </div>
  );
});
