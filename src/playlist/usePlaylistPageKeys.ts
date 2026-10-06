import { useId } from 'react';
import type { KeyChord } from '../nav/commandRegistry.ts';
import { useCommand } from '../nav/useCommand.ts';
import type { PlaylistTypeSearch } from './playlistTypeSearch.ts';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';

// 播放列表页表格上的键，设置页的快捷键一览也取这几份。

/** 移除选中的曲目。 */
export const REMOVE_TRACKS_KEYS: readonly KeyChord[] = [{ key: 'Delete' }];
/** 定位正在播放。 */
export const LOCATE_PLAYING_KEYS: readonly KeyChord[] = [{ key: 'F2' }];
/** 重取组封面。 */
export const REFRESH_COVERS_KEYS: readonly KeyChord[] = [{ key: 'F5' }];
export const UNDO_KEYS: readonly KeyChord[] = [{ key: 'z', ctrl: true }];
export const REDO_KEYS: readonly KeyChord[] = [
  { key: 'y', ctrl: true },
  { key: 'z', ctrl: true, shift: true },
];

export interface PlaylistPageKeysOptions {
  /** 焦点在这张表上：几条命令只在这时认。 */
  readonly focused: () => boolean;
  /** 此刻能移除：答假时 Delete 静默不发。 */
  readonly canRemove: () => boolean;
  readonly typeSearch: PlaylistTypeSearch | undefined;
  /** 发了撤销或重做：列表的顺序多半变了，列头的排序记号要收起。 */
  readonly onHistory: () => void;
}

/**
 * 播放列表页表格上的键：Delete 移除选中、F2 定位正在播放、F5 重取组封面、Ctrl+Z 撤销、Ctrl+Y 与
 * Ctrl+Shift+Z 重做。登记在部件层，焦点在表格上才认；表格自己不要这些键，缺省不拦，命令登记处接得到。
 */
export function usePlaylistPageKeys(guid: string, options: PlaylistPageKeysOptions): void {
  const page = useService(playlistPageKey);
  const id = useId();
  const enabled = options.focused;
  useCommand({
    id: `playlistPage.remove${id}`,
    layer: 'widget',
    keys: REMOVE_TRACKS_KEYS,
    enabled,
    run() {
      if (options.canRemove()) void page.tracks.remove(guid);
    },
  });
  useCommand({
    id: `playlistPage.locate${id}`,
    layer: 'widget',
    keys: LOCATE_PLAYING_KEYS,
    enabled,
    run() {
      options.typeSearch?.clear();
      void page.locate.locate();
    },
  });
  useCommand({
    id: `playlistPage.refreshCovers${id}`,
    layer: 'widget',
    keys: REFRESH_COVERS_KEYS,
    enabled,
    run: () => page.covers.refresh(guid),
  });
  useCommand({
    id: `playlistPage.undo${id}`,
    layer: 'widget',
    keys: UNDO_KEYS,
    enabled,
    run() {
      options.onHistory();
      void page.tracks.undo(guid);
    },
  });
  useCommand({
    id: `playlistPage.redo${id}`,
    layer: 'widget',
    keys: REDO_KEYS,
    enabled,
    run() {
      options.onHistory();
      void page.tracks.redo(guid);
    },
  });
}
