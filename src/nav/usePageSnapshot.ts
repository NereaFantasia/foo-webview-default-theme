import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { HistoryEntry, SnapshotHooks, SnapshotSlot } from './navHistory.ts';
import { useService } from '../kit/useService.ts';
import { historyKey } from './navHistory.ts';

/** 页面所在的历史记录，由中央区域给每一层提供；页面里的部件按它登记快照。 */
export const PageEntryContext = createContext<HistoryEntry | null>(null);

/**
 * 为所在页面的这条历史记录登记快照钩子。`ready` 为真（页面要的数据到齐）才登记：回到这条记录时，
 * 快照在登记那一刻交还，滚动与焦点于是落在已经取回的数据上。登记在布局阶段，交还发生在绘制之前。
 * 钩子取最近一次渲染传进来的，调用方不必记忆化；槽要在模块顶层建，换了槽会重新登记。
 */
export function usePageSnapshot<S extends object>(
  slot: SnapshotSlot<S>,
  hooks: SnapshotHooks<S>,
  ready: boolean,
): void {
  const entry = useContext(PageEntryContext);
  const history = useService(historyKey);
  const latest = useRef(hooks);
  useLayoutEffect(() => {
    latest.current = hooks;
  });
  useLayoutEffect(() => {
    if (!entry || !ready) return;
    return history.registerSnapshot(entry, slot, {
      capture: () => latest.current.capture(),
      restore: (snapshot) => latest.current.restore(snapshot),
    });
  }, [entry, history, slot, ready]);
}
