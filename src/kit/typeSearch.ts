/** 打字即跳的串最长这么多个字符，再按字母键就吞掉，不再追加。 */
export const TYPE_SEARCH_MAX_CHARS = 20;
/** 匹配完之后多久没有新键就清串，毫秒。 */
export const TYPE_SEARCH_EXPIRY_MS = 1000;

export interface TypeSearchState {
  readonly text: string;
  /** 最近一次匹配没找到；界面据此提示「没有以…开头的项」。 */
  readonly noMatch: boolean;
}

export interface TypeSearch {
  readonly state: TypeSearchState;
  /** 收下这个键就答 true（调用方据此 `preventDefault`）；不归打字即跳的键答 false。 */
  input(key: string): boolean;
  clear(): void;
  /** 状态变了就叫；返回退订函数。 */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/**
 * 数据全在内存里的打字即跳：串一变就同步找一次，找到交给 `apply` 落焦点，找不到亮 `noMatch`；
 * 1 s 没有新键清串。只收单个可打印字符（码点不小于 32 且不是 DEL），首字符不能是空白；
 * Backspace 退一格，串空时不归它。Esc 不归它：列表部件不许认领 Esc，Esc 只关浮层。
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
