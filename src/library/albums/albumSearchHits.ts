import type { LibraryTrackPartial } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import { trackAlbumKeyOf, type AlbumKey } from '../../host/libraryContract.ts';
import { TRACK_LIMIT } from '../libraryTracks.ts';

/** 键入到发起搜索之间的静默期，毫秒 */
export const HIT_DEBOUNCE_MS = 300;
/** 命中曲目数超过它就当词太宽，这一发作废：一个字母能命中半个库，传几万行对缩小范围没有帮助 */
export const HIT_LIMIT = 5000;
/** 只投影折成专辑键要的字段；不投影时宿主每行给全字段 */
const HIT_FIELDS = ['album', 'albumArtists', 'artists', 'albumId'];

export interface AlbumSearchHitsState {
  /** 曲目级命中折成的专辑键；null 为无有效命中（词空、超出上限、失败或未完成），调用方仅比对专辑字段 */
  readonly hits: ReadonlySet<AlbumKey> | null;
  /** 查询词非空且等待宿主响应；期间界面不判定无匹配，避免未完成查询闪烁空状态 */
  readonly pending: boolean;
  /** 高级查询宿主无法识别（`INVALID_PARAMS`）；保留前次命中直至新响应就绪 */
  readonly invalid: boolean;
}

const INITIAL: AlbumSearchHitsState = { hits: null, pending: false, invalid: false };

/** 向宿主问命中的一种请求：`search` 是普通词拼成的搜索串，`query` 是原样的 fb2k 查询 */
interface HitRequest {
  readonly kind: 'search' | 'query';
  readonly text: string;
}
const stateAtom = atom<AlbumSearchHitsState>(INITIAL);

export const albumSearchHitsAtom: Atom<AlbumSearchHitsState> = atom((get) => get(stateAtom));

export interface AlbumSearchHitsFace extends Pick<HostReadyFace, 'isAvailable'> {
  library: Pick<typeof fb.library, 'search' | 'query'>;
}

export interface AlbumSearchHitsService {
  /**
   * 过滤词变了：上一个词的命中立即撤掉、在路上的应答作废，去抖后按新词问宿主；词清空时不再问；
   * 仅空白或引号差异的词复用相同查询串，保持命中不重问
   */
  search(term: string): void;
  /**
   * 高级查询变更：原样提交宿主求值并折叠为专辑键，与 search 共享结果通道；
   * 语法错误时保留前次结果并置错误标记，新响应返回前维持现有命中避免界面闪烁，
   * 命中数量不设上限
   */
  query(raw: string): void;
  dispose(): void;
}

/**
 * 过滤词拼成 fb2k 查询串：每个词加引号、空格连接，由 fb2k 按全部可搜字段逐词 AND
 * 引号串里放不了引号，也没有转义写法，所以词里的 `"` 先换成空格；没有词时是空串
 */
export function libraryQueryOf(term: string): string {
  return term
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => `"${word}"`)
    .join(' ');
}

/** 命中行折成专辑键，口径与宿主折叠专辑一致（见 `trackAlbumKeyOf`）；没有专辑名的曲目不属于任何一张 */
function foldHits(tracks: readonly LibraryTrackPartial[]): ReadonlySet<AlbumKey> {
  const keys = new Set<AlbumKey>();
  for (const track of tracks) {
    const key = trackAlbumKeyOf(track);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * 启动过滤词的曲目级命中：专辑列表仅包含专辑名、专辑艺人与年份，曲目标题与流派需向宿主查询；
 * 命中曲目所属专辑整体并入筛选结果；查询失败静默处理，避免干扰主界面
 */
export function startAlbumSearchHits(
  store: Store,
  host: AlbumSearchHitsFace = fb,
): AlbumSearchHitsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 当前已生效或正在请求中的查询键（类型与查询串）；未发起时为空串 */
  let asked = '';
  /** 当前生效命中对应的请求类型，请求类型切换时重置结果 */
  let held: HitRequest['kind'] | null = null;

  function cancelTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  async function run(request: HitRequest, mine: number): Promise<void> {
    if (request.kind === 'search') {
      const answer = await settle(() =>
        host.library.search(request.text, HIT_LIMIT, { fields: HIT_FIELDS }),
      );
      if (disposed || mine !== generation) return;
      const usable = answer && answer.success !== false && answer.total <= HIT_LIMIT;
      store.set(stateAtom, {
        hits: usable ? foldHits(answer.tracks) : null,
        pending: false,
        invalid: false,
      });
      return;
    }
    const answer = await settle(() =>
      host.library.query(request.text, '', TRACK_LIMIT, HIT_FIELDS),
    );
    if (disposed || mine !== generation) return;
    if (answer && answer.success !== false) {
      store.set(stateAtom, { hits: foldHits(answer.tracks), pending: false, invalid: false });
    } else if (answer?.code === 'INVALID_PARAMS') {
      store.set(stateAtom, { ...store.get(stateAtom), pending: false, invalid: true });
    } else {
      store.set(stateAtom, INITIAL);
      held = null;
    }
  }

  /** 换一个请求；空请求（词空）撤掉命中不再问 */
  function ask(request: HitRequest | null): void {
    if (disposed) return;
    const key = request ? `${request.kind}:${request.text}` : '';
    if (key !== '' && key === asked) return;
    cancelTimer();
    const mine = ++generation;
    if (!request || !host.isAvailable()) {
      asked = '';
      held = null;
      store.set(stateAtom, INITIAL);
      return;
    }
    asked = key;
    // 普通词：旧词命中的专辑未必也命中新词（多打一个字就少一批），留到新应答回来会混进筛不出的专辑
    // 高级查询：边写边问，答复回来前留着上一份，免得整面墙在中间闪一下
    const keep = request.kind === 'query' && held === 'query';
    store.set(
      stateAtom,
      keep
        ? { ...store.get(stateAtom), pending: true }
        : { hits: null, pending: true, invalid: false },
    );
    held = request.kind;
    timer = setTimeout(() => {
      timer = undefined;
      void run(request, mine);
    }, HIT_DEBOUNCE_MS);
  }

  return {
    search(term) {
      const query = libraryQueryOf(term);
      ask(query === '' ? null : { kind: 'search', text: query });
    },
    query(raw) {
      const text = raw.trim();
      ask(text === '' ? null : { kind: 'query', text });
    },
    dispose() {
      disposed = true;
      generation += 1;
      cancelTimer();
    },
  };
}
