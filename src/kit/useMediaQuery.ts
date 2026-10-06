import { useCallback, useSyncExternalStore } from 'react';

/**
 * 一条媒体查询此刻是否成立，随窗口变化重渲染；首帧就是对的，不等量元素。没有 `matchMedia` 的环境答假。
 * `query` 应当是模块顶层的常量字符串。
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
