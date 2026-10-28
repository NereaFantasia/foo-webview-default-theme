import { useCallback, useSyncExternalStore } from 'react';

/**
 * 监听指定 CSS 媒体查询匹配状态的 Hook
 * 基于 `useSyncExternalStore` 实现首帧即时同步，窗口变动触发匹配变化时重新渲染；不支持 `matchMedia` 的环境安全回退为 false
 * @param query 媒体查询字符串（建议传入静态常量以避免重复订阅）
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof matchMedia !== 'function') return () => {};
      const media = matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () =>
    typeof matchMedia === 'function' ? matchMedia(query).matches : false,
  );
}
