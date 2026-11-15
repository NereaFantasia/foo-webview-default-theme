import { useMemo, useState } from 'react';
import { keepRemoved, withKept, type Keyed } from './favoritesRows.ts';

/**
 * 收藏页一类条目：取消收藏后数据马上改，这一行却留在本页里（心形变空，再点能收回来），离开页面才真的消失。
 * 留着的记在页面自己的状态里，页面卸掉就没了，回来时按此刻的收藏重画。`live` 要在条目没变时是同一个数组
 */
export function useRetainedEntries<E extends Keyed>(live: readonly E[]) {
  const [state, setState] = useState<{
    readonly before: readonly E[];
    readonly kept: ReadonlyMap<string, E>;
  }>(() => ({ before: live, kept: new Map() }));
  // 条目换了：在这一次渲染里对一遍，哪些不见了就留下，不等到下一帧才露出缺口
  if (state.before !== live)
    setState({ before: live, kept: keepRemoved(state.before, live, state.kept) });
  return useMemo(() => withKept(live, state.kept), [live, state.kept]);
}
