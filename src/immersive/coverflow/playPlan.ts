import type { CoverflowItem } from '../scene/coverflowItems.ts';

/**
 * 封面流选中项的起播执行计划
 *
 * 与队列页与历史页保持一致：历史已播按句柄重播，显式插队项按条目身份立即播放，上下文曲目从来源播放列表当前行顺序起播；
 * 避免统一按句柄插队而导致队列重复或丢失后续播放上下文
 */
export type PlayPlan =
  | { readonly kind: 'handle'; readonly handle: string }
  | { readonly kind: 'queue'; readonly entry: string }
  | {
      readonly kind: 'from';
      /** 关联来源分段；用于在执行起播前确认对应列表分段的刷新状态 */
      readonly source: 'earlier' | 'upNext';
      readonly guid: string;
      readonly row: number;
      readonly handle: string;
    };

/** 解析封面流条目的起播计划；当前播放曲目无起播计划 */
export function playPlanOf(item: CoverflowItem): PlayPlan | null {
  switch (item.kind) {
    case 'current':
      return null;
    case 'played':
      return { kind: 'handle', handle: item.track.handle };
    case 'queued':
      return { kind: 'queue', entry: item.entry };
    case 'earlier':
    case 'upNext':
      return {
        kind: 'from',
        source: item.kind,
        guid: item.guid,
        row: item.row,
        handle: item.track.handle,
      };
  }
}
