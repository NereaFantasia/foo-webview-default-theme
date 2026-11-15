import type { LibraryTrack } from 'foo-webview-sdk';
import { albumKeyOf, trackAlbumKeyOf, type Album } from '../../host/libraryContract.ts';
import type { TableRowItem, TableTrack } from '../../table/tableItems.ts';
import type { TrackStats } from '../album-list/listSort.ts';
import { withStats } from '../playStats.ts';

/** 歌曲页的条目流与它的换算 */
export interface SongsView {
  /** 一行一首，键是 handle：换排序、换条件之后焦点仍跟着同一首。行序号就是显示位 */
  readonly items: readonly TableRowItem[];
  /** 显示位上的那一首；整库曲目还没到、或库刚变过还没对上时是 undefined */
  readonly trackAt: (index: number) => LibraryTrack | undefined;
  /** 已对上的各首时长之和，秒 */
  readonly duration: number;
}

/**
 * 按宿主排好的 handle 从整库曲目里取行；给了播放统计时并进行里，添加时间、播放次数与最近播放三列才有字
 * 统计里的空串是没有，不并
 */
export function buildSongsView(
  handles: readonly string[],
  byHandle: ReadonlyMap<string, LibraryTrack>,
  stats: ReadonlyMap<string, TrackStats> | null,
): SongsView {
  const tracks: (LibraryTrack | undefined)[] = handles.map((handle) => byHandle.get(handle));
  let duration = 0;
  const items = handles.map((handle, order): TableRowItem => {
    const track = tracks[order];
    if (track && track.duration > 0) duration += track.duration;
    const extra = track && stats?.get(handle);
    const row: TableTrack | undefined = track && withStats(track, extra);
    return { kind: 'row', key: handle, order, track: row };
  });
  return { items, trackAt: (index) => tracks[index], duration };
}

/**
 * 表格行所属的专辑：表格交回的行只有 `TableTrack` 的字段，折专辑键要的多值艺术家按 handle 从整库曲目里取；
 * 在线曲目、没有专辑名的、或库里没有这张专辑的答 undefined。歌曲页与搜索的曲目页共用
 */
export function albumLookupOf(
  albums: readonly Album[],
  byHandle: ReadonlyMap<string, LibraryTrack>,
): (track: TableTrack) => Album | undefined {
  const index = new Map(albums.map((album) => [albumKeyOf(album), album]));
  return (track) => {
    const full = byHandle.get(track.handle);
    const key = full ? trackAlbumKeyOf(full) : null;
    return key ? index.get(key) : undefined;
  };
}
