import { useState } from 'react';
import type {
  ColumnMenuChoice,
  ColumnMenuExtras,
} from '../../src/table/columns/ColumnMenuExtras.tsx';
import type { TableItem } from '../../src/table/tableItems.ts';
import { log, type HarnessGroup } from './tableHarnessScenario.ts';

// 表格试验页的列头菜单附加段：排序与分组两段都给，点了什么记进动作记录；分组开关、依据与全部折叠 / 展开
// 真的改试验页的状态，测试看得到置灰与行的开合。标签借表格已有的文案。

const SORTS: readonly ColumnMenuChoice[] = [
  { id: 'title', label: 'table.title' },
  { id: 'artist', label: 'table.artist' },
];

const MODES: readonly ColumnMenuChoice[] = [
  { id: 'album', label: 'table.album' },
  { id: 'artist', label: 'table.artist' },
];

export function useHarnessMenu(
  enabled: boolean,
  items: readonly TableItem<HarnessGroup>[],
  setCollapsed: (next: ReadonlySet<string>) => void,
): ColumnMenuExtras | undefined {
  const [grouping, setGrouping] = useState({ enabled: true, mode: 'album' });
  if (!enabled) return undefined;
  const hasGroups = items.some((item) => item.kind === 'group');
  return {
    sort: {
      choices: SORTS,
      pick: (id) => log({ type: 'sortBy', id }),
      shuffle: () => log({ type: 'shuffle' }),
      reverse: () => log({ type: 'reverse' }),
    },
    groups: {
      enabled: grouping.enabled,
      mode: grouping.mode,
      modes: MODES,
      canCollapse: grouping.enabled && hasGroups,
      setEnabled(next) {
        log({ type: 'grouping', enabled: next });
        setGrouping((now) => ({ ...now, enabled: next }));
      },
      setMode(mode) {
        log({ type: 'groupMode', mode });
        setGrouping((now) => ({ ...now, mode }));
      },
      collapseAll() {
        setCollapsed(new Set(items.flatMap((item) => (item.kind === 'group' ? [item.key] : []))));
      },
      expandAll() {
        setCollapsed(new Set());
      },
    },
  };
}
