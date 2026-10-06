import type { Atom } from 'jotai/vanilla';
import { createContext, useContext, type ComponentType } from 'react';
import type { TableTrack } from './tableItems.ts';
import type { TrackRatingsService } from '../track/trackRatings.ts';

export interface TableServices {
  readonly ratings: Pick<TrackRatingsService, 'watch' | 'ratingOf' | 'canRate' | 'setRating'>;
  readonly playingKey: Atom<string>;
  readonly audible: Atom<boolean>;
  readonly trackKey: (track: TableTrack) => string;
  readonly PlayingMark: ComponentType<{ readonly active: boolean; readonly label: string }>;
}

/** 表格依赖由装配层提供，不读取页面或窗口的服务容器。 */
export const TableContext = createContext<TableServices | null>(null);

export function useTableServices(): TableServices {
  const services = useContext(TableContext);
  if (!services) throw new Error('曲目表格尚未提供服务');
  return services;
}

/**
 * 曲目信息卡的预览，由装配层提供，没有时不上报。只上报用户主动落到的曲目；恢复焦点和播放定位不切换预览。
 */
export const TablePreviewContext = createContext<((track: TableTrack) => void) | null>(null);
