/** 页面可见性：沉浸视图的取数循环在页面隐藏时停下，回到前台再开。 */
export interface PageVisibility {
  /** 页面此刻是否隐藏（窗口最小化、隐藏到托盘等）。 */
  hidden(): boolean;
  /** 隐藏态每变一次叫一次 `listener`；返回摘掉它的函数。 */
  subscribe(listener: () => void): () => void;
}

/** 读可见性只用到 `document` 的这几项。 */
export interface VisibilityDocument {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

function globalDocument(): VisibilityDocument | null {
  return typeof document === 'undefined' ? null : document;
}

/**
 * 按 `document.hidden` 与 `visibilitychange` 给出可见性；缺省取全局的 `document`。
 * 没有 `document` 的环境（node）一直算可见，订阅什么也不做。
 */
export function createPageVisibility(
  source: VisibilityDocument | null = globalDocument(),
): PageVisibility {
  return {
    hidden: () => source?.hidden ?? false,
    subscribe(listener) {
      if (!source) return () => {};
      source.addEventListener('visibilitychange', listener);
      return () => source.removeEventListener('visibilitychange', listener);
    },
  };
}
