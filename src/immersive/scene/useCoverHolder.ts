import { useCallback } from 'react';
import { sharedCoverHolders } from './coverHolders.ts';

/**
 * 申请共享视图过渡封面命名标识的 ref 回调
 *
 * 挂载时向共享持有者管理器注册节点并按 layer 优先级竞选封面过渡命名，卸载时释放占用；确保预设切换时平滑衔接
 */
export function useCoverHolder(layer = 0): (element: HTMLElement | null) => (() => void) | void {
  return useCallback(
    (element: HTMLElement | null) =>
      element ? sharedCoverHolders.claim(element, layer) : undefined,
    [layer],
  );
}
