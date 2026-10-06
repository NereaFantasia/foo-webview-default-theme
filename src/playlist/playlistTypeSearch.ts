import { fb } from 'foo-webview-sdk/bridge';
import { findPlaylistPrefix, PREFIX_FIELDS } from './playlistPrefixSearch.ts';

/** 打字即跳的串最长这么多个字符，再按字母键就吞掉，不再追加。 */
const MAX_CHARS = 20;
/** 键入到开始扫描的静默期，毫秒：每次扫描都要翻页取行，连着敲不该连着扫。 */
export const TYPE_SEARCH_DEBOUNCE_MS = 500;
/** 找完之后多久没有新键就清串，毫秒。 */
export const TYPE_SEARCH_EXPIRY_MS = 1000;

export interface PlaylistTypeSearchState {
  readonly text: string;
  /** 最近一次没找到；界面据此提示「没有以…开头的项」。 */
  readonly noMatch: boolean;
  readonly scanning: boolean;
  /** 最近一次扫描取行失败了。 */
  readonly failed: boolean;
}

/** 此刻表格上是哪张列表、显示的是整张还是过滤命中。每次扫描前后各取一次，变了就作罢。 */
export interface PlaylistTypeSearchTarget {
  readonly guid: string;
  readonly total: number;
  /** 过滤态的命中；不在过滤态时为 null，扫描向宿主翻页。 */
  readonly hits: readonly PlaylistTypeSearchHit[] | null;
}

export interface PlaylistTypeSearchHit {
  readonly index: number;
  readonly row: { readonly albumArtist: string; readonly title: string; readonly album: string };
}

export interface PlaylistTypeSearch {
  readonly state: PlaylistTypeSearchState;
  /** 收下这个键就答 true（调用方据此 `preventDefault`）；不归打字即跳的键答 false。 */
  input(key: string): boolean;
  /** 清串并作废进行中的扫描；换了列表、换了过滤词时调。 */
  clear(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface PlaylistTypeSearchFace {
  playlist: Pick<typeof fb.playlist, 'getTracks'>;
}

const IDLE: PlaylistTypeSearchState = { text: '', noMatch: false, scanning: false, failed: false };

/**
 * 播放列表页的打字即跳：行是分页取的，找不能在内存里同步做，静默 `TYPE_SEARCH_DEBOUNCE_MS` 后从头翻页
 * 找前缀（字段优先级见 `findPlaylistPrefix`），找到交给 `locate` 落焦点与选中，`locate` 答假（那一行
 * 此刻看不见）也算没找到。过滤态只在命中里找，不向宿主要行。
 *
 * 只收单个可打印字符（码点不小于 32 且不是 DEL），首字符不能是空白，串长到上限就吞掉后续键；Backspace
 * 退一格。Esc 不归它：列表部件不认领 Esc，Esc 只关浮层。每次串变先作废上一次扫描；找完
 * `TYPE_SEARCH_EXPIRY_MS` 没有新键就清串。
 */
export function createPlaylistTypeSearch(
  target: () => PlaylistTypeSearchTarget,
  locate: (row: number) => boolean,
  host: PlaylistTypeSearchFace = fb,
): PlaylistTypeSearch {
  let state = IDLE;
  let generation = 0;
  let disposed = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function set(patch: Partial<PlaylistTypeSearchState>): void {
    const next = { ...state, ...patch };
    if (
      next.text === state.text &&
      next.noMatch === state.noMatch &&
      next.scanning === state.scanning &&
      next.failed === state.failed
    ) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function stopTimers(): void {
    if (debounce !== undefined) clearTimeout(debounce);
    if (expiry !== undefined) clearTimeout(expiry);
    debounce = undefined;
    expiry = undefined;
  }

  function clear(): void {
    generation += 1;
    stopTimers();
    set(IDLE);
  }

  async function search(mine: number): Promise<void> {
    const text = state.text;
    const at = target();
    const current = () => {
      const now = target();
      return (
        !disposed &&
        mine === generation &&
        now.guid === at.guid &&
        now.total === at.total &&
        now.hits === at.hits
      );
    };
    const hits = at.hits;
    set({ scanning: true });
    let found = -1;
    let failed = false;
    try {
      found = await findPlaylistPrefix(text, {
        total: hits?.length ?? at.total,
        current,
        page: async (start, count) => {
          if (hits) return hits.slice(start, start + count).map((hit) => hit.row);
          const page = await host.playlist.getTracks(at.guid, start, count, undefined, [
            ...PREFIX_FIELDS,
          ]);
          if (!current()) return [];
          if (page.success === false || page.total !== at.total || page.start !== start) {
            throw new Error('playlist changed while searching');
          }
          return page.tracks;
        },
      });
    } catch {
      failed = true;
    }
    if (!current()) {
      // 扫描途中表格换了一份（换了过滤、增删了行）：结果对不上，这一串作罢。串变过、已释放的归新的那一轮。
      if (!disposed && mine === generation) clear();
      return;
    }
    if (failed) {
      set({ scanning: false, failed: true });
    } else {
      const row = hits ? (hits[found]?.index ?? -1) : found;
      set({ scanning: false, noMatch: row < 0 || !locate(row) });
    }
    expiry = setTimeout(clear, TYPE_SEARCH_EXPIRY_MS);
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
        chars.pop();
      } else {
        const code = key.codePointAt(0) ?? 0;
        if ([...key].length !== 1 || code < 32 || code === 127) return false;
        if (chars.length === 0 && key.trim() === '') return false;
        if (chars.length >= MAX_CHARS) return true;
        chars.push(key);
      }
      generation += 1;
      stopTimers();
      const text = chars.join('');
      set({ ...IDLE, text });
      if (text === '') return true;
      const mine = generation;
      debounce = setTimeout(() => void search(mine), TYPE_SEARCH_DEBOUNCE_MS);
      return true;
    },
    clear,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      generation += 1;
      stopTimers();
      listeners.clear();
    },
  };
}
