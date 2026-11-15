import type { MessageKey } from '../../../i18n/en.ts';

export type OnlineColumn =
  | 'number'
  | 'cover'
  | 'title'
  | 'artist'
  | 'album'
  | 'added'
  | 'quality'
  | 'favorite'
  | 'duration'
  | 'menu';

/**
 * 曲目表的几种列：搜索结果不带序号；在线列表带序号与行尾的 ⋯，专辑那一种不出封面与专辑两列；
 * 收藏页另有收藏时间。列宽写在样式里，按 `data-layout` 取
 */
export const ONLINE_TRACK_LAYOUTS = {
  search: ['cover', 'title', 'artist', 'album', 'quality', 'favorite', 'duration'],
  list: ['number', 'cover', 'title', 'artist', 'album', 'quality', 'favorite', 'duration', 'menu'],
  album: ['number', 'title', 'artist', 'quality', 'favorite', 'duration', 'menu'],
  favorites: [
    'number',
    'cover',
    'title',
    'artist',
    'album',
    'added',
    'quality',
    'favorite',
    'duration',
    'menu',
  ],
} as const satisfies Record<string, readonly OnlineColumn[]>;
export type OnlineTrackLayout = keyof typeof ONLINE_TRACK_LAYOUTS;

/** 有字的列头；在线列表页的排序字段也照它写 */
export const ONLINE_COLUMN_LABELS = {
  title: 'table.title',
  artist: 'table.artist',
  album: 'table.album',
  added: 'favorites.added',
  quality: 'online.quality',
  duration: 'table.duration',
} as const satisfies Partial<Record<OnlineColumn, MessageKey>>;

export interface OnlineTrackSort {
  /** `number` 是列表本来的顺序 */
  readonly column: OnlineColumn;
  readonly descending: boolean;
}
