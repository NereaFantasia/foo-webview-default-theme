import { useAtomValueRawSync } from 'jotai/react';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { AlbumDropdown } from './dropdown/AlbumDropdown.tsx';
import { AlbumSectionHead } from './AlbumSectionHead.tsx';
import { AlbumTile } from './AlbumTile.tsx';
import { AlbumTileKeys } from './AlbumTileKeys.tsx';
import { AlbumColorTheme } from '../AlbumColorTheme.tsx';
import styles from './AlbumWall.module.css';
import { AlbumWallSkeleton } from './AlbumWallSkeleton.tsx';
import { albumBrowseAtom } from '../albums/albumBrowse.ts';
import { albumCoversVersionAtom } from '../albumCovers.ts';
import { albumDetailPendingAtom } from '../album-detail/albumDetailOpen.ts';
import { withDropdowns } from './albumDropdown.ts';
import type { GridPosition } from './albumGridKeys.ts';
import type { MenuPoint } from '../albumMenu.ts';
import { albumSearchHitsAtom } from '../albums/albumSearchHits.ts';
import { albumSelectionAtom } from '../albums/albumSelection.ts';
import { BrowseEmptyState } from '../albums/BrowseEmptyState.tsx';
import { TILE_SIZE_MAX } from '../albums/browserPrefs.ts';
import { playbackPausedAtom, playingAlbumKeyAtom } from '../playingAlbum.ts';
import { TypeSearchBadge } from '../../kit/TypeSearchBadge.tsx';
import { foldGroups, useAlbumDropdown } from './dropdown/useAlbumDropdown.ts';
import { useAlbumWallInput } from './useAlbumWallInput.ts';
import { useAlbumWallLayout } from './useAlbumWallLayout.ts';
import { useAlbumWallRows } from './useAlbumWallRows.ts';
import { useAlbumWallView, type WallView } from './useAlbumWallView.ts';
import { useWallReflow } from './useWallReflow.ts';
import { headerReflowKey, REFLOW_KEY_ATTR, reflowPlaces, tileReflowKey } from './wallReflow.ts';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';
import { playbackKey } from '../../playback/playbackContract.ts';

export interface AlbumWallProps {
  /** 页面替封面墙记着的样子，切形态回来时交还。 */
  readonly memory: { current: WallView | null };
  /** 专辑菜单的作用对象已经备好，该在 `point` 处打开菜单了。 */
  readonly onMenu: (point: MenuPoint) => void;
}

/**
 * 封面墙：按行虚拟滚动的网格。一个条目是一整行图块、一个节头或一条下拉；图块不嵌在行里，而是按专辑键
 * 摊成一层绝对定位的元素，换列时同一张专辑是同一个元素，`<img>` 不重建，位移也有起点（`wallReflow.ts`）。
 * 单击封面在它那一行下面开合下拉（见 `WallFold`），开合时下面的元素按 `data-fold` 分组平移。
 *
 * 选中与焦点分开：选中是一个集合，焦点是一块（`aria-activedescendant`、键盘起点、键盘时的焦点环）。
 * 取封面按边长上限取，不按当前边长：宿主的缩放缓存按请求尺寸分档，拖滑块时按实际边长取会一档档重抽。
 */
export function AlbumWall({ memory, onMenu }: AlbumWallProps) {
  const t = useAtomValueRawSync(translateAtom);
  const albums = useService(albumsKey);
  const playback = useService(playbackKey);
  const browse = useAtomValueRawSync(albumBrowseAtom);
  const selected = useAtomValueRawSync(albumSelectionAtom);
  const playingKey = useAtomValueRawSync(playingAlbumKeyAtom);
  const paused = useAtomValueRawSync(playbackPausedAtom);
  const pending = useAtomValueRawSync(albumDetailPendingAtom);
  const opening = pending?.origin === 'album' ? pending.key : null;
  useAtomValueRawSync(albumCoversVersionAtom);
  const gridId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const base = useAlbumWallLayout();
  const searching = useAtomValueRawSync(albumSearchHitsAtom).pending;
  const settled =
    (browse.phase === 'ready' || browse.phase === 'noMatch') && !searching && base.width > 0;
  const dropdown = useAlbumDropdown({ scroller, layout: base, settled });
  const { placements, views, reach } = dropdown.snapshot;
  const items = useMemo(
    () => withDropdowns(base.items, placements, base.metrics.gap),
    [base.items, placements, base.metrics.gap],
  );
  const layout = { ...base, items };
  const groupOf = useMemo(() => foldGroups(items), [items]);
  const rows = useAlbumWallRows(scroller, layout, reach);
  useWallReflow({
    rows: dropdown.rows,
    scroller,
    places: reflowPlaces(items, rows.rows, rows.tiles, layout.row.offset),
    columns: layout.width > 0 ? layout.row.perRow : 0,
    animate: layout.reflowMotion,
    scrollBefore: rows.scrollBefore,
  });
  const tileId = useCallback((at: GridPosition) => `${gridId}-${at.index}-${at.column}`, [gridId]);
  const { measure } = layout;
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      scroller.current = element;
      const release = measure(element);
      return () => {
        scroller.current = null;
        release?.();
      };
    },
    [measure],
  );
  const { fold } = dropdown;
  const onToggle = fold.toggle.bind(fold);
  const input = useAlbumWallInput({ scroller, layout, rows, tileId, onMenu, onToggle });
  useAlbumWallView({ ...input, scroller, items, settled, memory, dropdown: fold });

  const [hover, setHover] = useState<string | null>(null);
  const [keysMounted, setKeysMounted] = useState(false);
  // 指针在图块之间的空隙上也不卸键，只挪出视口：卸掉重建的话，滚轮滚动时样式重算又会成倍上涨。
  const over = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-tile-keys]')) return;
    const key = target?.closest<HTMLElement>('[data-tile-key]')?.dataset['tileKey'] ?? null;
    setHover(key);
    if (key !== null) setKeysMounted(true);
  };
  const hovered = hover === null ? undefined : rows.tiles.find((tile) => tile.key === hover);
  const hoveredPlaying = hovered !== undefined && hovered.albumKey === playingKey;

  const { row, metrics } = layout;
  const vars: CSSProperties & Record<`--${string}`, string> = {
    '--tile-size': `${row.tileSize}px`,
    '--tile-line': `${metrics.lineHeight}px`,
    '--row-inset': `${Math.round(row.offset)}px`,
    // 图块的横坐标在样式里按这两个算（与 `placeVisible` 同一个算式），宽度变而列数不变时图块不必重新渲染。
    '--row-offset': `${row.offset}px`,
    '--tile-pitch': `${row.tileSize + row.spacing}px`,
  };
  const multi = selected.size > 1;
  const focusedId = input.position ? tileId(input.position) : undefined;
  return (
    <div className={styles.root}>
      <div
        ref={attach}
        className={styles.scroller}
        style={vars}
        role="grid"
        tabIndex={0}
        aria-label={t('album.grid')}
        aria-multiselectable
        aria-rowcount={layout.items.length}
        aria-activedescendant={focusedId}
        data-album-wall
        onKeyDown={(event) => {
          if (!dropdown.tabInto(event)) input.onKeyDown(event);
        }}
        onKeyUp={input.onKeyUp}
        onPointerOver={over}
        onPointerLeave={() => setHover(null)}
      >
        <div ref={dropdown.rows} className={styles.rows} style={{ height: rows.totalSize }}>
          {rows.rows.map((virtual) => {
            const item = items[virtual.index];
            if (!item) return null;
            const place = { transform: `translateY(${virtual.start}px)` };
            if (item.kind === 'header') {
              return (
                <div
                  key={item.section.key === null ? 'unknown' : `h:${item.section.key}`}
                  className={styles.header}
                  role="row"
                  aria-rowindex={virtual.index + 1}
                  {...{ [REFLOW_KEY_ATTR]: headerReflowKey(item.section.key) }}
                  data-fold={groupOf(virtual.index) || undefined}
                  style={{ ...place, height: metrics.headerHeight }}
                >
                  <AlbumSectionHead
                    section={item.section}
                    collapsed={item.collapsed}
                    columns={row.perRow}
                    onToggle={albums.browse.toggleSection}
                  />
                </div>
              );
            }
            if (item.kind === 'dropdown') {
              const view = views.find((candidate) => candidate.id === item.id);
              return view ? (
                <AlbumDropdown
                  key={`d:${item.id}`}
                  view={view}
                  column={item.column}
                  top={virtual.start}
                  group={groupOf(virtual.index)}
                  row={row}
                  rowIndex={virtual.index}
                  visibleOf={dropdown.visibleOf}
                  onClose={dropdown.close}
                  onMenu={onMenu}
                />
              ) : null;
            }
            const owned = item.albums.map((_, column) => tileId({ index: virtual.index, column }));
            return (
              <div
                key={`r:${virtual.index}`}
                className={styles.line}
                role="row"
                aria-rowindex={virtual.index + 1}
                aria-owns={owned.join(' ')}
                style={place}
              />
            );
          })}
          {rows.tiles.map((tile) => (
            <AlbumTile
              key={tile.key}
              id={tileId(tile)}
              tileKey={tile.key}
              album={tile.album}
              index={tile.index}
              column={tile.column}
              y={tile.y}
              cover={albums.covers.coverOf(tile.album, TILE_SIZE_MAX)}
              selected={selected.has(tile.albumKey)}
              checked={multi && selected.has(tile.albumKey)}
              focused={focusedId === tileId(tile)}
              playing={tile.albumKey === playingKey}
              audible={tile.albumKey === playingKey && !paused}
              opening={tile.albumKey === opening}
              hovered={tile.key === hover}
              showText={metrics.textHeight > 0}
              fold={groupOf(tile.index)}
              handlers={input.handlers}
            />
          ))}
          {keysMounted && (
            <AlbumColorTheme album={hovered?.album ?? null}>
              <AlbumTileKeys
                follow={hovered ? tileReflowKey(hovered.key) : undefined}
                x={hovered?.x ?? 0}
                y={hovered?.y ?? 0}
                size={row.tileSize}
                hidden={!hovered}
                fold={hovered ? groupOf(hovered.index) : 0}
                state={hoveredPlaying ? (paused ? 'paused' : 'playing') : 'idle'}
                onPlay={() => {
                  if (!hovered) return;
                  if (hoveredPlaying) void playback.playOrPause();
                  else input.handlers.play(hovered.album);
                }}
                onMore={(point) => {
                  if (!hovered) return;
                  scroller.current?.focus({ preventScroll: true });
                  input.handlers.menu(hovered.album, hovered, point);
                }}
              />
            </AlbumColorTheme>
          )}
        </div>
      </div>
      {input.search && <TypeSearchBadge search={input.search} />}
      {browse.phase === 'loading' && <AlbumWallSkeleton layout={layout} />}
      {(browse.phase === 'disabled' || browse.phase === 'empty' || browse.phase === 'noMatch') && (
        <BrowseEmptyState phase={browse.phase} />
      )}
    </div>
  );
}
