import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import { trackAlbumKeyOf, type AlbumKey } from '../../host/libraryContract.ts';

/** 键入到发起搜索之间的静默期，毫秒。 */
export const HIT_DEBOUNCE_MS = 300;
/** 命中曲目数超过它就当词太宽，这一发作废：一个字母能命中半个库，传几万行对缩小范围没有帮助。 */
export const HIT_LIMIT = 5000;
/** 折成专辑键只要这三项；不投影时宿主每行给全字段。 */
const HIT_FIELDS = ['album', 'albumArtists', 'artists'];

export interface AlbumSearchHitsState {
  /** 曲目级命中折成的专辑键；null 是没有（词空、词太宽、失败或还没回来），调用方只按专辑字段过。 */
  readonly hits: ReadonlySet<AlbumKey> | null;
  /** 词非空而宿主还没答。界面这时不判「无匹配」，免得专辑字段零命中先闪一下空态。 */
  readonly pending: boolean;
}

const INITIAL: AlbumSearchHitsState = { hits: null, pending: false };
const stateAtom = atom<AlbumSearchHitsState>(INITIAL);

export const albumSearchHitsAtom: Atom<AlbumSearchHitsState> = atom((get) => get(stateAtom));

export interface AlbumSearchHitsFace extends Pick<HostReadyFace, 'isAvailable'> {
  library: Pick<typeof fb.library, 'search'>;
}

export interface AlbumSearchHitsService {
  /**
   * 过滤词变了：上一个词的命中立即撤掉、在路上的应答作废，去抖后按新词问宿主；词清空时不再问。
   * 只差空白或引号的词拼出同一个查询串，命中照旧，不撤也不重问。
   */
  search(term: string): void;
  dispose(): void;
}

/**
 * 过滤词拼成 fb2k 查询串：每个词加引号、空格连接，由 fb2k 按全部可搜字段逐词 AND。
 * 引号串里放不了引号，也没有转义写法，所以词里的 `"` 先换成空格；没有词时是空串。
 */
export function libraryQueryOf(term: string): string {
  return term
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => `"${word}"`)
    .join(' ');
}

/** 命中行折成专辑键，口径与宿主折叠专辑一致（见 `trackAlbumKeyOf`）；没有专辑名的曲目不属于任何一张。 */
function foldHits(tracks: readonly LibraryTrackPartial[]): ReadonlySet<AlbumKey> {
  const keys = new Set<AlbumKey>();
  for (const track of tracks) {
    const key = trackAlbumKeyOf(track);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * 启动过滤词的曲目级命中：专辑清单上只有专辑名、专辑艺术家与年份可比，曲目标题、流派这些要问宿主。
 * 命中的专辑整张并进过滤结果。失败静默：过滤是辅助，不为它挂横幅。
 */
export function startAlbumSearchHits(
  store: Store,
  host: AlbumSearchHitsFace = fb,
): AlbumSearchHitsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 眼下的命中或在路上的那一发对应的查询串；没有时是空串。 */
  let asked = '';

  function cancelTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  async function run(query: string, mine: number): Promise<void> {
    const answer = await settle(() =>
      host.library.search(query, HIT_LIMIT, { fields: HIT_FIELDS }),
    );
    if (disposed || mine !== generation) return;
    const usable = answer && answer.success !== false && answer.total <= HIT_LIMIT;
    store.set(stateAtom, { hits: usable ? foldHits(answer.tracks) : null, pending: false });
  }

  return {
    search(term) {
      if (disposed) return;
      const query = libraryQueryOf(term);
      if (query !== '' && query === asked) return;
      cancelTimer();
      const mine = ++generation;
      if (!query || !host.isAvailable()) {
        asked = '';
        store.set(stateAtom, INITIAL);
        return;
      }
      asked = query;
      // 旧词命中的专辑未必也命中新词（多打一个字就少一批），留到新应答回来会混进筛不出的专辑。
      store.set(stateAtom, { hits: null, pending: true });
      timer = setTimeout(() => {
        timer = undefined;
        void run(query, mine);
      }, HIT_DEBOUNCE_MS);
    },
    dispose() {
      disposed = true;
      generation += 1;
      cancelTimer();
    },
  };
}
