import type { PlaylistTrackPartial, Track } from 'foo-webview-sdk';

export const UP_NEXT_FIELDS = [
  'handle',
  'path',
  'absolutePath',
  'subsong',
  'title',
  'artist',
  'artists',
  'album',
  'albumArtist',
  'albumArtists',
  'duration',
  'rating',
] as const satisfies readonly (keyof Track)[];
export type UpNextTrack = Pick<Track, (typeof UP_NEXT_FIELDS)[number]>;
export const UP_NEXT_PAGE_SIZE = 200;

export interface UpNextRow {
  /** 列表、行号与句柄共同标识一次出现，列表改动后不复用过时的行。 */
  readonly key: string;
  readonly row: number;
  /** 续播序列中的位置，从 0 起；循环回绕后仍连续递增。 */
  readonly offset: number;
  readonly track: UpNextTrack;
}

export interface UpNextView {
  readonly list: { readonly guid: string; readonly index: number; readonly name: string } | null;
  /** 只保留已读缓存页；没有数据的位置仍按 total 占据滚动高度。 */
  readonly rows: readonly UpNextRow[];
  readonly total: number;
  /** 来源列表的总行数，用于显示实际序号；不随剩余曲目数缩小。 */
  readonly sourceCount: number;
  /** 当前一轮尚未播到的数量；余下部分属于下一轮。 */
  readonly currentCount: number;
  /** 新起点尚未确认时保留布局，旧行暂不接受命令。 */
  readonly refreshing: boolean;
  readonly version: number;
  readonly failedPages: ReadonlySet<number>;
}

export const EMPTY_UP_NEXT: UpNextView = {
  list: null,
  rows: [],
  total: 0,
  sourceCount: 0,
  currentCount: 0,
  refreshing: false,
  version: 0,
  failedPages: new Set(),
};

export interface UpNextSource {
  readonly list: NonNullable<UpNextView['list']>;
  readonly count: number;
  readonly after: number;
  readonly total: number;
}

/** 续播偏移换成来源列表里从 1 起的序号；下一轮回到 1，未读元数据时也能显示。 */
export function upNextNumberAt(view: UpNextView, offset: number): number | null {
  if (view.sourceCount === 0 || offset < 0 || offset >= view.total) return null;
  return ((view.sourceCount - view.currentCount + offset) % view.sourceCount) + 1;
}

export function upNextTrackOf(track: PlaylistTrackPartial): UpNextTrack {
  return {
    handle: track.handle ?? '',
    path: track.path ?? '',
    absolutePath: track.absolutePath ?? '',
    subsong: track.subsong ?? 0,
    title: track.title ?? '',
    artist: track.artist ?? '',
    artists: track.artists ?? [],
    album: track.album ?? '',
    albumArtist: track.albumArtist ?? '',
    albumArtists: track.albumArtists ?? [],
    duration: track.duration ?? 0,
    rating: track.rating ?? 0,
  };
}
