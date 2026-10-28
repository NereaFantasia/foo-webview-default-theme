import { useState } from 'react';
import { choiceCodec, defineLocalPref } from '../../../kit/localPref.ts';
import { useFilterSurface, type FilterSurfaceState } from '../../../track/FilterSurface.tsx';

/** 筛选面板的呈现形态：浮层弹出、页面内停靠展开、页面内停靠折叠 */
const MODES = ['popover', 'docked', 'collapsed'] as const;
type FilterMode = (typeof MODES)[number];

const modePref = defineLocalPref<FilterMode>({
  key: 'default-theme.online-filter.v1',
  fallback: 'popover',
  ...choiceCodec(MODES),
});

/**
 * 管理在线筛选面板的呈现形态并持久化至浏览器偏好。
 * 停靠模式下分别记录展开与收起状态；窗口处于窄屏档位时强制回退为弹出浮层，但不覆盖已持久化的偏好配置
 */
export function useOnlineFilterSurface(narrow: boolean): FilterSurfaceState {
  const [mode, setMode] = useState<FilterMode>(() => modePref.read());
  const change = (next: FilterMode) => {
    setMode(next);
    modePref.write(next);
  };
  return useFilterSurface({
    docked: mode !== 'popover',
    expanded: mode === 'docked',
    narrow,
    onDock: (docked) => change(docked ? 'docked' : 'popover'),
    onExpand: (open) => change(open ? 'docked' : 'collapsed'),
  });
}
