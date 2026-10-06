import { createContext, use, type ComponentType, type RefObject } from 'react';
import type { PageProps, PlaceId } from '../nav/places.ts';

/**
 * 外壳里由其他业务填的位置。外壳不导入其他业务，`app/` 装配时经 `ShellSlotsContext` 填入；
 * 参数形状由外壳定，填进来的组件按结构对上。
 */
export interface ShellSlots {
  /** 中央区各地点的页面；没登记的地点显示占位页。 */
  readonly pages: Partial<Record<PlaceId, ComponentType<PageProps>>>;
  /** 展开态侧边栏顶部的搜索框。 */
  readonly SidebarSearch: ComponentType;
  /** 展开态侧边栏的播放列表节；`selected` 是侧边栏此刻点亮的选中键。 */
  readonly SidebarPlaylists: ComponentType<{
    readonly className?: string;
    readonly selected: string | null;
  }>;
  /** 图标态点「播放列表」弹出的浮层，贴着 `anchor` 的右边。 */
  readonly PlaylistFlyout: ComponentType<{
    readonly anchor: RefObject<HTMLElement | null>;
    readonly selected: string | null;
    readonly panel: RefObject<HTMLDivElement | null>;
    onDismiss(escape: boolean): void;
  }>;
  /** 图标态的搜索项要的动作：打开搜索。按 Hook 的规矩在组件顶层调用。 */
  useShowSearch(): () => void;
}

export const ShellSlotsContext = createContext<ShellSlots | null>(null);

export function useShellSlots(): ShellSlots {
  const slots = use(ShellSlotsContext);
  if (!slots) throw new Error('外壳插槽未装配');
  return slots;
}
