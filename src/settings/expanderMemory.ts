import { createContext } from 'react';

/** 一张可展开卡交给登记处的把手 */
export interface ExpanderHandle {
  isOpen(): boolean;
  /** 直接到位，不播开合动画 */
  setOpen(open: boolean): void;
}

/**
 * 设置页里各张可展开卡的开合：随页面的历史快照存取，后退、前进回到这条记录时按它还原；
 * 新进设置页仍是各卡自己的缺省，开合不跨记录记。同一次访问里换分区会卸掉那一区的卡，登记处记下它们
 * 卸掉时的开合，换回来按它还原。卡按「所在组 + 标题」认，重名的后登记的盖掉先登记的
 */
export interface ExpanderRegistry {
  register(key: string, handle: ExpanderHandle): () => void;
  /** 此刻各张卡是开是合，含已卸掉的 */
  capture(): Record<string, boolean>;
  /** 把快照里的开合交还；还没登记的卡（数据到齐后才出现的、换分区后才挂上的）等它登记时再交 */
  restore(open: Readonly<Record<string, boolean>>): void;
}

export function createExpanderRegistry(): ExpanderRegistry {
  const handles = new Map<string, ExpanderHandle>();
  // 等卡登记时交出的开合：快照里还没挂上的卡，或已卸掉的卡卸掉时的样子
  const waiting = new Map<string, boolean>();
  return {
    register(key, handle) {
      handles.set(key, handle);
      const wanted = waiting.get(key);
      if (wanted !== undefined) {
        waiting.delete(key);
        handle.setOpen(wanted);
      }
      return () => {
        if (handles.get(key) !== handle) return;
        handles.delete(key);
        waiting.set(key, handle.isOpen());
      };
    },
    capture() {
      const open: Record<string, boolean> = Object.fromEntries(waiting);
      for (const [key, handle] of handles) open[key] = handle.isOpen();
      return open;
    },
    restore(open) {
      waiting.clear();
      for (const [key, value] of Object.entries(open)) {
        const handle = handles.get(key);
        if (handle) handle.setOpen(value);
        else waiting.set(key, value);
      }
    },
  };
}

/** 设置页给下面的展开卡提供；不在设置页里（别处用到展开卡）时是 null，卡不登记 */
export const ExpanderRegistryContext = createContext<ExpanderRegistry | null>(null);

/** 卡所在的设置组，由 `SettingsGroup` 提供；不在组里时是 null，卡不登记 */
export const SettingsGroupContext = createContext<string | null>(null);
