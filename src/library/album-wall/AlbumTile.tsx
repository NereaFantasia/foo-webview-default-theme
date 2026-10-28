import { Record48Regular } from '@fluentui/react-icons';
import {
  memo,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import styles from './AlbumTile.module.css';
import type { AlbumCover } from '../albumCovers.ts';
import type { GridPosition } from './albumGridKeys.ts';
import type { MenuPoint } from '../albumMenu.ts';
import { albumArtistOf, type Album } from '../../host/libraryContract.ts';
import type { CoverOutcome } from '../../covers/coverGate.ts';
import type { Modifiers } from '../../kit/keyedSelection.ts';
import { useCoverLoad } from '../../covers/useCoverLoad.ts';
import { CheckBadge, OpeningBadge, PlayingBadge } from '../cover-tile/TileBadges.tsx';
import { TileArt } from '../cover-tile/TileArt.tsx';
import { TileLabels } from '../cover-tile/TileLabels.tsx';
import { REFLOW_KEY_ATTR, tileReflowKey } from '../cover-tile/tileReflow.ts';

/**
 * 图块交互处理函数集；整张网格共享稳定引用以支持子树重渲染跳过
 * 操作位置以条目与列坐标表示，以区分同一专辑跨节出现的多个实例
 */
export interface TileHandlers {
  select(album: Album, at: GridPosition, modifiers: Modifiers): void;
  /** 单击展开或收起该专辑的下拉详情面板 */
  toggle(album: Album, at: GridPosition): void;
  play(album: Album): void;
  menu(album: Album, at: GridPosition, point: MenuPoint): void;
  press(album: Album, at: GridPosition, event: PointerEvent): void;
  dragStart(album: Album, at: GridPosition, event: DragEvent): void;
  acquire(album: Album): boolean;
  settle(album: Album, outcome: CoverOutcome): void;
  shown(album: Album): boolean;
  wait(retry: () => void): () => void;
}

export interface AlbumTileProps {
  readonly id: string;
  /** 图块渲染键（PlacedTile.key），用于网格识别指针停留目标 */
  readonly tileKey: string;
  readonly album: Album;
  readonly index: number;
  /** 行内列号，与网格行偏移、列距共同用于样式中计算横坐标 */
  readonly column: number;
  /** 在行层坐标系中的顶部垂直坐标，单位 CSS 像素 */
  readonly y: number;
  readonly cover: AlbumCover | undefined;
  readonly selected: boolean;
  /** 多选态标记；多选选中的图块在左上角展示复选勾，单选时不展示 */
  readonly checked: boolean;
  readonly focused: boolean;
  readonly playing: boolean;
  /** 正在播放的专辑是否处于发声状态；用于驱动指示器动效，非播放中图块恒为 false */
  readonly audible: boolean;
  /** 从该图块菜单进入详情页加载较慢时展示封面中央旋转动画 */
  readonly opening: boolean;
  /** 指针悬停指示；此时隐藏右下角正在播放标记以让位于悬停操作按钮 */
  readonly hovered: boolean;
  readonly showText: boolean;
  /** 折叠分组索引，用于与正在展开/收起的分组实现联动平移（见 foldGroups） */
  readonly fold: number;
  readonly handlers: TileHandlers;
}

/** 生成图块绝对定位样式属性（见 AlbumTile.module.css .tile） */
function placeOf(column: number, y: number): CSSProperties & Record<`--${string}`, string> {
  return { '--tile-column': String(column), '--tile-y': `${y}px` };
}

/** 提取键盘修饰键状态；Ctrl 与 Meta 等效映射 */
function modifiersOf(event: MouseEvent): Modifiers {
  return { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey };
}

/**
 * 封面墙专辑图块：方形封面与两行文字标签
 * 封面加载受 useCoverLoad 配额管理，加载完成或异常均释放配额
 * 悬停播放与更多按钮通过顶层单一实例复用（见 AlbumTileKeys），不在单个图块内实例化
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
        // 单击展开下拉：忽略双击的第二击，携带修饰键时仅更新选中状态
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
      <TileArt
        src={image.src}
        placeholder={Record48Regular}
        seen={() => handlers.shown(album)}
        onLoad={image.onLoad}
        onError={image.onError}
        selected={props.selected}
        focused={props.focused}
      >
        {props.playing && <PlayingBadge audible={props.audible} covered={props.hovered} />}
        {props.checked && <CheckBadge />}
        {props.opening && <OpeningBadge />}
      </TileArt>
      {props.showText && <TileLabels title={album.name} subtitle={artist} />}
    </div>
  );
});
