import { fb } from 'foo-webview-sdk/bridge';
import type { Atom, PrimitiveAtom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import {
  UNKNOWN_DECADE,
  facetOptionsOf,
  type TrackFacet,
  type TrackFacetOptions,
} from '../../track/trackFacets.ts';
import { createHolds, createSlots } from '../playlistHolds.ts';
import type { PlaylistRowsService } from '../playlistRows.ts';

/** 行或标签变了到重取取值之间的合并窗口，毫秒 */
export const FACETS_COALESCE_MS = 300;
/**
 * 列表行数超过此阈值时不计算分面选项：
 * 分面依赖相邻游程归并，若列表未按目标栏排布则几乎每行成段，响应体积会随行数线性膨胀；
 * 当前阈值为估算上限，尚未在大列表上进行实测
 */
export const MAX_FACET_ROWS = 50_000;
/** 多值标签各值之间的分隔，与整库流派读值是同一个控制字符 */
const SEPARATOR = '\u001f';

/**
 * 播放列表的筛选面板列哪几栏。专辑一栏按文件夹归没有专辑艺人的曲目，列表里还可能有不在本地库里的曲目，
 * 宿主的游程键给不出这样的归法，不列
 */
export const PLAYLIST_FACETS = [
  'genre',
  'decade',
  'artist',
] as const satisfies readonly TrackFacet[];

/**
 * 每栏取哪个键：流派与艺人取全部标签值（显示串用「, 」拼接，单个值里也可能有逗号，拆不得），
 * 年代取日期的前四个字，之后按年份归档
 */
const PATTERNS: Readonly<Record<(typeof PLAYLIST_FACETS)[number], string>> = {
  genre: '$if($meta_num(genre),$meta_sep(genre,$char(31)),)',
  artist: '$if($meta_num(artist),$meta_sep(artist,$char(31)),)',
  decade: '$left(%date%,4)',
};

export interface PlaylistFacetsState {
  /**
   * - `idle`：没有页面请求
   * - `loading`：取数中，旧的一份保留显示
   * - `ready`：已取到
   * - `unavailable`：取不到或列表太大
   */
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable';
  readonly options: TrackFacetOptions | null;
}

const IDLE: PlaylistFacetsState = { status: 'idle', options: null };

export interface PlaylistFacetsFace extends HostReadyFace {
  playlist: Pick<typeof fb.playlist, 'getGroupRuns'>;
}

export interface PlaylistFacetsDeps {
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
}

export interface PlaylistFacetsService {
  /** 一张列表的分面取值；没有页面要它时是 `IDLE` */
  stateOf(guid: string): Atom<PlaylistFacetsState>;
  /** 筛选面板打开着、要看分面时调，开始取这张的取值；返回的函数在面板收起时调 */
  acquire(guid: string): () => void;
  dispose(): void;
}

interface Entry {
  readonly guid: string;
  readonly own: PrimitiveAtom<PlaylistFacetsState>;
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** 按行服务哪一版内容与标签取过；取过之前是空串 */
  loadedFor: string;
  closed: boolean;
  off: () => void;
}

/** 日期前四个字归成年代：没写日期是「未知」，不以四位数字开头的不归任何一档，同歌曲页的口径 */
function decadeOfYear(key: string): string | null {
  if (key.trim() === '') return UNKNOWN_DECADE;
  return /^\d{4}$/.test(key) ? `${key.slice(0, 3)}0s` : null;
}

function add(counts: Map<string, number>, name: string, count: number): void {
  counts.set(name, (counts.get(name) ?? 0) + count);
}

/**
 * 播放列表页筛选面板的分面取值：向宿主按每一栏的键要整张列表的游程，同一个值的各段首数加起来。只取边界不取
 * 行，宿主在工作线程上算；只在面板打开着时取，行增删或标签变了重取。取不到、列表太大时不给取值，
 * 面板里不出这一块
 */
export function startPlaylistFacets(
  store: Store,
  deps: PlaylistFacetsDeps,
  host: PlaylistFacetsFace = fb,
): PlaylistFacetsService {
  const slots = createSlots(IDLE);
  const waiter = waitForHost(host);
  let connected = false;
  let disposed = false;

  const read = (entry: Entry) => store.get(entry.own);
  const update = (entry: Entry, patch: Partial<PlaylistFacetsState>) => {
    if (!entry.closed) store.set(entry.own, { ...read(entry), ...patch });
  };

  function stopTimer(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  async function load(entry: Entry): Promise<void> {
    if (!connected || entry.closed || disposed) return;
    const rows = store.get(deps.rows.stateOf(entry.guid));
    if (rows.status !== 'ready') return;
    entry.loadedFor = `${rows.contentVersion}:${rows.tagVersion}`;
    if (rows.total > MAX_FACET_ROWS) {
      update(entry, { status: 'unavailable', options: null });
      return;
    }
    const generation = ++entry.generation;
    const stale = () => disposed || entry.closed || generation !== entry.generation;
    update(entry, { status: 'loading' });
    const answers = await Promise.all(
      PLAYLIST_FACETS.map((facet) =>
        settle(() => host.playlist.getGroupRuns([PATTERNS[facet]], entry.guid)),
      ),
    );
    if (stale()) return;
    const counts = {
      genre: new Map<string, number>(),
      decade: new Map<string, number>(),
      artist: new Map<string, number>(),
      album: new Map<string, number>(),
    };
    for (const [at, facet] of PLAYLIST_FACETS.entries()) {
      const answer = answers[at];
      if (!answer || answer.success === false) {
        update(entry, { status: 'unavailable', options: null });
        return;
      }
      for (const run of answer.runs) {
        if (facet === 'decade') {
          const decade = decadeOfYear(run.key);
          if (decade !== null) add(counts.decade, decade, run.count);
          continue;
        }
        for (const value of new Set(run.key.split(SEPARATOR))) {
          if (value !== '') add(counts[facet], value, run.count);
        }
      }
    }
    update(entry, { status: 'ready', options: facetOptionsOf(counts) });
  }

  /** 排一次取数；`delay` 是合并窗口，面板刚打开的第一次不等 */
  function schedule(entry: Entry, delay = FACETS_COALESCE_MS): void {
    stopTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void load(entry);
    }, delay);
  }

  function onRows(entry: Entry): void {
    const rows = store.get(deps.rows.stateOf(entry.guid));
    if (rows.status !== 'ready') return;
    if (entry.loadedFor === `${rows.contentVersion}:${rows.tagVersion}`) return;
    entry.generation += 1;
    schedule(entry);
  }

  const holds = createHolds<Entry>(
    (guid) => {
      const entry: Entry = {
        guid,
        own: slots.own(guid),
        generation: 0,
        timer: undefined,
        loadedFor: '',
        closed: false,
        off: () => {},
      };
      store.set(entry.own, IDLE);
      entry.off = store.sub(deps.rows.stateOf(guid), () => onRows(entry));
      schedule(entry, 0);
      return entry;
    },
    (entry) => {
      entry.closed = true;
      entry.generation += 1;
      stopTimer(entry);
      entry.off();
      store.set(entry.own, IDLE);
    },
  );

  void waiter.done.then((arrived) => {
    if (!arrived || disposed) return;
    connected = true;
    for (const [, entry] of holds.entries()) schedule(entry, 0);
  });

  return {
    stateOf: slots.view,
    acquire: (guid) => holds.acquire(guid),
    dispose() {
      disposed = true;
      waiter.cancel();
      holds.dispose();
    },
  };
}
