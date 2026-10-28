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
import { NO_KEY_SLOTS, nextKeySlots } from './tileKeySlots.ts';
import { REFLOW_KEY_ATTR, tileReflowKey } from '../cover-tile/tileReflow.ts';
import { useTileReflow } from '../cover-tile/useTileReflow.ts';
import { headerReflowKey, reflowPlaces } from './wallReflow.ts';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';
import { playbackKey } from '../../playback/playbackContract.ts';

export interface AlbumWallProps {
  /** 封面墙视图状态记忆引用，形态切换时恢复滚动与选中 */
  readonly memory: { current: WallView | null };
  /** 弹出专辑操作菜单回调函数，point 为点击坐标 */
  readonly onMenu: (point: MenuPoint) => void;
}

/**
 * 封面墙：按行虚拟滚动的网格组件
 * 条目流由整行图块、节头或下拉详情组成；图块作为绝对定位层统一平铺，换列时复用元素节点以保证图片不重新加载并触发位移动画（`cover-tile/tileReflow.ts`）
 * 单击封面触发对应行下方展开下拉面板（见 `WallFold`），下方元素通过 `data-fold` 分组同步平移
 *
 * 选中态与键盘焦点解耦：选中维护集合状态，焦点对应单项（配合 `aria-activedescendant` 与焦点环呈现）
 * 封面图片统一按尺寸上限请求，以稳定命中缩放缓存并避免滑块拖拽时高频重采样
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
  useTileReflow({
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
  // 指针移动至图块间隙时不销毁按钮，仅淡出隐藏，避免频繁滚动时由于节点销毁重建导致样式重算开销
  const over = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-tile-keys]')) return;
    const key = target?.closest<HTMLElement>('[data-tile-key]')?.dataset['tileKey'] ?? null;
    setHover(key);
    if (key !== null) setKeysMounted(true);
  };
  const hovered = hover === null ? undefined : rows.tiles.find((tile) => tile.key === hover);
  const [slots, setSlots] = useState(NO_KEY_SLOTS);
  const nextSlots = nextKeySlots(slots, hovered);
  if (nextSlots !== slots) setSlots(nextSlots);

  const { row, metrics } = layout;
  const vars: CSSProperties & Record<`--${string}`, string> = {
    '--tile-size': `${row.tileSize}px`,
    '--tile-line': `${metrics.lineHeight}px`,
    '--row-inset': `${Math.round(row.offset)}px`,
    // 图块横坐标通过 CSS 变量在样式中计算；列数不变仅微调宽度时无需触发图块重渲染
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
          {keysMounted &&
            slots.tiles.map((keyed, slot) => {
              if (!keyed) return null;
              const hidden = !slots.visible || slots.current !== slot;
              const keyedPlaying = keyed.albumKey === playingKey;
              return (
                <AlbumColorTheme key={slot} album={keyed.album}>
                  <AlbumTileKeys
                    follow={tileReflowKey(keyed.key)}
                    x={keyed.x}
                    y={keyed.y}
                    size={row.tileSize}
                    hidden={hidden}
                    fold={groupOf(keyed.index)}
                    state={keyedPlaying ? (paused ? 'paused' : 'playing') : 'idle'}
                    onPlay={() => {
                      if (hidden) return;
                      if (keyedPlaying) void playback.playOrPause();
                      else input.handlers.play(keyed.album);
                    }}
                    onMore={(point) => {
                      if (hidden) return;
                      scroller.current?.focus({ preventScroll: true });
                      input.handlers.menu(keyed.album, keyed, point);
                    }}
                  />
                </AlbumColorTheme>
              );
            })}
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
