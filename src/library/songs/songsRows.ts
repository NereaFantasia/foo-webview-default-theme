import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  type LibraryEventsFace,
} from '../../host/libraryContract.ts';
import { TRACK_LIMIT } from '../libraryTracks.ts';

/** 歌曲页要宿主排的一次：哪串查询、按哪个排序串、要不要反过来。 */
export interface SongsRequest {
  readonly query: string;
  readonly sort: string;
  readonly descending: boolean;
}

export type SongsRowsStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface SongsRowsState {
  /** failed：最近一次读取失败，手上的旧顺序照旧留着。 */
  readonly status: SongsRowsStatus;
  /** 最近一次宿主认不出那串查询（`INVALID_PARAMS`）；手上留着上一次的结果。 */
  readonly invalid: boolean;
  /** 命中的曲目，按显示顺序（降序已反过来）的 handle。行数据按它从整库曲目里取。 */
  readonly handles: readonly string[];
  /** 这份 `handles` 答的是哪一次；还没答过时为 null。 */
  readonly answered: SongsRequest | null;
  /** 每换一份 `handles` 加一。 */
  readonly generation: number;
}

const INITIAL: SongsRowsState = {
  status: 'idle',
  invalid: false,
  handles: [],
  answered: null,
  generation: 0,
};
const stateAtom = atom<SongsRowsState>(INITIAL);

export const songsRowsAtom: Atom<SongsRowsState> = atom((get) => get(stateAtom));

export interface SongsRowsFace extends HostReadyFace, LibraryEventsFace {
  library: Pick<typeof fb.library, 'query'>;
}

export interface SongsRowsService {
  /** 页面挂着时要：头一次时连上宿主并订库变更，有没答的请求就发；返回放手函数。没人要时不取。 */
  acquire(): () => void;
  /** 换一次请求，`delay` 毫秒后发（打字时去抖）；与手上的一样就不发。只差方向时就地反过来，不问宿主。 */
  request(next: SongsRequest, delay?: number): void;
  /** 去抖中的请求马上发（回车）。 */
  flush(): void;
  /** 失败横幅上的重试。 */
  retry(): Promise<void>;
  dispose(): void;
}

const sameRequest = (a: SongsRequest | null, b: SongsRequest | null) =>
  a !== null &&
  b !== null &&
  a.query === b.query &&
  a.sort === b.sort &&
  a.descending === b.descending;

/**
 * 歌曲页的顺序：宿主按查询与排序串排好命中，只答 handle。规矩同整库曲目：先订库变更再取，变更合并一阵后重取，
 * 重取期间旧的留着；晚到的旧应答丢掉。
 */
export function startSongsRows(store: Store, host: SongsRowsFace = fb): SongsRowsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let holders = 0;
  let generation = 0;
  let wanted: SongsRequest | null = null;
  // 手上的结果因库变更过时了，下次有人要时重取。
  let stale = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offLibrary: (() => void) | undefined;
  let connecting: Promise<boolean> | null = null;
  const waiter = waitForHost(host);
  const update = (change: Partial<SongsRowsState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });

  function cancelTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  async function load(): Promise<void> {
    const request = wanted;
    if (disposed || holders === 0 || request === null || !(await connect())) return;
    if (disposed || holders === 0 || request !== wanted) return;
    const mine = ++generation;
    stale = false;
    update({ status: 'loading', invalid: false });
    const answer = await settle(() =>
      host.library.query(request.query, request.sort, TRACK_LIMIT, ['handle']),
    );
    if (disposed || mine !== generation) return;
    if (!answer || answer.success === false) {
      if (answer?.code === 'INVALID_PARAMS') update({ status: 'ready', invalid: true });
      else update({ status: 'failed', invalid: false });
      return;
    }
    const handles = answer.tracks.flatMap((track) => (track.handle ? [track.handle] : []));
    if (request.descending) handles.reverse();
    store.set(stateAtom, {
      status: 'ready',
      invalid: false,
      handles,
      answered: request,
      generation: store.get(stateAtom).generation + 1,
    });
  }

  function schedule(delay: number): void {
    cancelTimer();
    if (disposed || holders === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void load();
    }, delay);
  }

  function connect(): Promise<boolean> {
    connecting ??= waiter.done.then((arrived) => {
      if (!arrived || disposed) return false;
      offLibrary = onLibraryChanged(host, () => {
        generation += 1;
        stale = true;
        schedule(LIBRARY_COALESCE_MS);
      });
      return true;
    });
    return connecting;
  }

  return {
    acquire() {
      holders += 1;
      const answered = store.get(stateAtom).answered;
      if (wanted !== null && (stale || !sameRequest(wanted, answered))) schedule(0);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) {
          generation += 1;
          stale ||= store.get(stateAtom).status === 'loading';
          cancelTimer();
        }
      };
    },
    request(next, delay = 0) {
      if (disposed || sameRequest(next, wanted)) return;
      generation += 1;
      wanted = next;
      const state = store.get(stateAtom);
      const answered = state.answered;
      const usable = !stale && answered !== null;
      if (usable && sameRequest(answered, next)) {
        // 改了又改回来：手上的就是，挂着的那一发不要了。
        cancelTimer();
        generation += 1;
        update({ status: 'ready', invalid: false });
        return;
      }
      if (usable && answered.query === next.query && answered.sort === next.sort) {
        // 只差方向：同一份结果反过来就是，不必再让宿主排一遍。
        cancelTimer();
        generation += 1;
        store.set(stateAtom, {
          ...state,
          status: 'ready',
          invalid: false,
          handles: [...state.handles].reverse(),
          answered: next,
          generation: state.generation + 1,
        });
        return;
      }
      schedule(delay);
    },
    flush() {
      if (timer !== undefined) schedule(0);
    },
    retry() {
      cancelTimer();
      return load();
    },
    dispose() {
      disposed = true;
      generation += 1;
      cancelTimer();
      waiter.cancel();
      offLibrary?.();
    },
  };
}
