import { useCallback, useMemo, useState } from 'react';
import type { MusicTrack } from '../../../server/musicObjects.ts';
import { blockedTrack } from './OnlineItems.tsx';
import { removeOnlineChip } from './onlineFilterChips.ts';
import {
  EMPTY_ONLINE_FILTER,
  filterOnlineTracks,
  onlineConditionCount,
  onlineFacetOptions,
  toggleOnlineFacet,
  toggleOnlinePreset,
  type OnlineFacet,
  type OnlinePreset,
  type OnlineScope,
  type OnlineTrackFilter,
} from './onlineTrackFilter.ts';

/** 搜索匹配范围与过滤条件组合，用于页面离开与返回时的现场恢复 */
export interface OnlineFilterView {
  readonly scope: OnlineScope;
  readonly filter: OnlineTrackFilter;
}

const INITIAL: OnlineFilterView = { scope: 'any', filter: EMPTY_ONLINE_FILTER };

/**
 * 在线搜索结果的字段限定与客户端二次筛选。由于服务端接口不支持按指定字段检索，
 * 客户端对已获取结果做二次过滤。分面候选值与计数基于按字段过滤后的曲目集计算，不随筛选条件的增减级联消失
 */
export function useOnlineFilter(
  tracks: readonly MusicTrack[],
  text: string,
  unblock: boolean | null,
  options: {
    /** 恢复页面时传入的初始筛选现场 */
    readonly initial?: OnlineFilterView | undefined;
    /** 筛选条件或检索范围变更时的回调，用于清除列表选中项并重置滚动位置；现场恢复时不触发 */
    onRefine?(): void;
  } = {},
) {
  const [view, setView] = useState<OnlineFilterView>(options.initial ?? INITIAL);
  const playable = useCallback((track: MusicTrack) => !blockedTrack(track, unblock), [unblock]);
  const scoped = useMemo(
    () => filterOnlineTracks(tracks, text, view.scope, EMPTY_ONLINE_FILTER, playable),
    [tracks, text, view.scope, playable],
  );
  const shown = useMemo(
    () => filterOnlineTracks(scoped, text, 'any', view.filter, playable),
    [scoped, text, view.filter, playable],
  );
  const facets = useMemo(() => onlineFacetOptions(scoped), [scoped]);
  const refine = (next: (now: OnlineFilterView) => OnlineFilterView) => {
    setView(next);
    options.onRefine?.();
  };
  const change = (next: (filter: OnlineTrackFilter) => OnlineTrackFilter) =>
    refine((now) => ({ ...now, filter: next(now.filter) }));
  const count = onlineConditionCount(view.filter);
  return {
    ...view,
    /** 经过检索范围与过滤条件筛选后的最终曲目列表；未设条件时返回原始结果集 */
    shown,
    facets,
    count,
    active: view.scope !== 'any' || count > 0,
    setScope: (scope: OnlineScope) => refine((now) => ({ ...now, scope })),
    togglePreset: (preset: OnlinePreset) => change((filter) => toggleOnlinePreset(filter, preset)),
    toggleFacet: (facet: OnlineFacet, value: string) =>
      change((filter) => toggleOnlineFacet(filter, facet, value)),
    removeChip: (key: string) => change((filter) => removeOnlineChip(filter, key)),
    clear: () => change(() => EMPTY_ONLINE_FILTER),
    restore: setView,
  };
}

export type OnlineFilter = ReturnType<typeof useOnlineFilter>;
