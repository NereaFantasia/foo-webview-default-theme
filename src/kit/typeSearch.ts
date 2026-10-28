/** 键盘键入即搜（Type-ahead）缓冲区的最大字符长度上限。超出长度的后续输入将被忽略拦截 */
export const TYPE_SEARCH_MAX_CHARS = 20;
/** 连续输入键入即搜的空闲过期重置窗口时长（毫秒，默认 1000 ms） */
export const TYPE_SEARCH_EXPIRY_MS = 1000;

export interface TypeSearchState {
  readonly text: string;
  /** 最近一次前缀匹配未命中任何条目；调用方据此展示无匹配反馈 */
  readonly noMatch: boolean;
}

export interface TypeSearch {
  readonly state: TypeSearchState;
  /** 处理按键输入。若识别并消费该键返回 true（调用方据此阻止默认行为），否则返回 false */
  input(key: string): boolean;
  clear(): void;
  /** 注册状态变更监听器，返回注销函数 */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/**
 * 创建基于内存的键入即搜（Type-ahead / Type-to-search）状态机
 * 缓冲文本变更时同步调用 `find` 执行前缀检索：命中时调用 `apply` 转移选中/焦点，未命中则将 `noMatch` 置为 true；
 * 空闲超时（1000 ms）自动清空缓冲
 * 仅接收单个可打印字符（首字符不可为空白）；支持 Backspace 逐字回退；不处理 Esc 键（保持由外层浮层统一响应）
 */
export function createTypeSearch<T>(
  find: (text: string) => T | undefined,
  apply: (hit: T) => void,
): TypeSearch {
  let state: TypeSearchState = { text: '', noMatch: false };
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();

  function set(next: TypeSearchState): void {
    if (next.text === state.text && next.noMatch === state.noMatch) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function stopExpiry(): void {
    if (expiry !== undefined) clearTimeout(expiry);
    expiry = undefined;
  }

  function clear(): void {
    stopExpiry();
    set({ text: '', noMatch: false });
  }

  function search(text: string): void {
    stopExpiry();
    if (!text) {
      set({ text, noMatch: false });
      return;
    }
    const hit = find(text);
    set({ text, noMatch: hit === undefined });
    if (hit !== undefined) apply(hit);
    if (!disposed) expiry = setTimeout(clear, TYPE_SEARCH_EXPIRY_MS);
  }

  return {
    get state() {
      return state;
    },
    input(key) {
      if (disposed) return false;
      const chars = [...state.text];
      if (key === 'Backspace') {
        if (chars.length === 0) return false;
        search(chars.slice(0, -1).join(''));
        return true;
      }
      const code = key.codePointAt(0) ?? 0;
      if ([...key].length !== 1 || code < 32 || code === 127) return false;
      if (chars.length === 0 && key.trim() === '') return false;
      if (chars.length >= TYPE_SEARCH_MAX_CHARS) return true;
      search(state.text + key);
      return true;
    },
    clear,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      stopExpiry();
      listeners.clear();
    },
  };
}
