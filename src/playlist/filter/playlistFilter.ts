import type { ConfigWriter } from '../../host/configWrite.ts';
import { fb } from 'foo-webview-sdk/bridge';
import type { Atom, PrimitiveAtom } from 'jotai/vanilla';
import {
  defineConfigPref,
  oneOf,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../../host/configPref.ts';
import { settle } from '../../host/hostCall.ts';
import { waitForHost } from '../../host/waitForHost.ts';
import type { PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { createHolds, createSlots } from '../playlistHolds.ts';
import { playlistRowOf, type PlaylistRow } from '../playlistRow.ts';
import type { PlaylistRowsService } from '../playlistRows.ts';
import { ROWS_COALESCE_MS } from '../playlistRowSource.ts';
import { queryInputText, type QueryMode } from '../../track/queryInput.ts';
import { togglePreset, type PresetId } from '../../track/queryPresets.ts';
import { conditionKey, conditionQuery, type TrackCondition } from '../../track/trackConditions.ts';
import {
  EMPTY_TRACK_FACETS,
  toggleTrackFacet,
  trackFacetCount,
  type TrackFacet,
  type TrackFacetSelection,
} from '../../track/trackFacets.ts';
import { trackQueryOf, type TrackFilter } from '../../track/trackFilter.ts';
import { QUERY_SCOPES, type QueryScope } from '../../track/trackQuery.ts';
import {
  startPlaylistFilterSurface,
  type PlaylistFilterSurfaceService,
} from './playlistFilterPrefs.ts';

/** 一次取行向宿主要多少行 */
export const SCAN_PAGE = 200;
/** 命中上限：十页的量级，够翻看，也挡住「搜一个 a 就把十万行搬进内存」 */
export const MATCH_LIMIT = 2000;
/** 取行的途中列表变了，最多重问宿主几次 */
const QUERY_ATTEMPTS = 2;
/** 键入到开始求值的静默期，毫秒：每次求值都要问宿主并取回命中的行，连着敲不该连着问 */
export const FILTER_DEBOUNCE_MS = 300;
/**
 * 标签变了到重算的等待，毫秒。长过行服务的合并窗口：变的曲目在行缓存里时行服务先推进标签版本，
 * 那一路的重算会撤掉这里的定时，同一次变动不算两遍
 */
const TAGS_SETTLE_MS = ROWS_COALESCE_MS * 2;

// 键名沿用已发布的版本，用户上次选的那一档原样读回；新加的几档旧版本读到时退回「全部字段」
const SCOPE = defineConfigPref<QueryScope>('defaultTheme.searchScope', 'all', oneOf(QUERY_SCOPES));

export interface PlaylistHit {
  /** 在列表里的行号 */
  readonly index: number;
  readonly row: PlaylistRow;
}

export interface PlaylistFilterState {
  /**
   * 普通搜索的输入框原文，给了就写，首尾空白也留着：受控的输入框按它显示，逐字敲到词间的空格时不能被吃掉
   * 求值用的是从它切出来的词
   */
  readonly query: string;
  /** 输入框在哪种模式；两种模式各留一份草稿，只有当前模式的那份参与过滤 */
  readonly mode: QueryMode;
  /** 高级查询的原文：fb2k 查询，交宿主求值 */
  readonly advancedText: string;
  /** 宿主认不出高级查询（`INVALID_PARAMS`）；手上留着上一份命中，下一份答复落地时撤掉 */
  readonly invalid: boolean;
  /** 勾上的常用预设；与词、条件同时生效 */
  readonly presets: ReadonlySet<PresetId>;
  /** 勾上的分面（流派、年代、艺人），栏内取或、跨栏取与 */
  readonly facets: TrackFacetSelection;
  /** 条件，给了就写，条件行照它画 */
  readonly conditions: readonly TrackCondition[];
  /** 表格在过滤态：求值落地才为真，与 `hits` 同步。为假时表格照常显示整张列表 */
  readonly active: boolean;
  /** 落地的这一份求值用的框内原文（已去首尾空白），框里没有字时是空串 */
  readonly term: string;
  readonly scanning: boolean;
  /** 命中数到了上限，后面的没再取 */
  readonly truncated: boolean;
  /** 命中的行，按列表顺序 */
  readonly hits: readonly PlaylistHit[];
  /** 这批命中取数之前拿的评分戳，见 `TrackRatingsService.stamp` */
  readonly stamp: number;
}

export const NO_FILTER: PlaylistFilterState = {
  query: '',
  mode: 'text',
  advancedText: '',
  invalid: false,
  presets: new Set(),
  facets: EMPTY_TRACK_FACETS,
  conditions: [],
  active: false,
  term: '',
  scanning: false,
  truncated: false,
  hits: [],
  stamp: 0,
};

/** 过滤状态里属于「筛选」的那几项，形状同歌曲页的筛选 */
export function trackFilterOf(
  state: Pick<
    PlaylistFilterState,
    'mode' | 'query' | 'advancedText' | 'presets' | 'facets' | 'conditions'
  >,
): TrackFilter {
  return {
    mode: state.mode,
    text: state.query,
    advancedText: state.advancedText,
    presets: state.presets,
    facets: state.facets,
    conditions: state.conditions,
  };
}

export interface PlaylistFilterFace extends ConfigPrefFace {
  on: typeof fb.on;
  playlist: Pick<typeof fb.playlist, 'getMatchingRows' | 'getTracksAt'>;
}

export interface PlaylistFilterDeps {
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
  /** 评分服务的戳：每次求值开始之前拿一次 */
  readonly stamp: () => number;
}

export interface PlaylistFilterService {
  readonly persistence: ConfigPersistence;
  readonly ready: Promise<void>;
  /** 字段范围，随 profile 记住 */
  readonly scopeAtom: Atom<QueryScope>;
  setScope(scope: QueryScope): void;
  /** 筛选面板的呈现（嵌入还是浮层、展开没展开），随这台机器记住 */
  readonly surface: PlaylistFilterSurfaceService;
  /** 一张列表的过滤；同一 GUID 总是同一个原子，没有页面要它时是 `NO_FILTER` */
  stateOf(guid: string): Atom<PlaylistFilterState>;
  acquire(guid: string): () => void;
  /** 键入：输入先记下，静默 `FILTER_DEBOUNCE_MS` 后求值；当前模式的文字清空了马上按剩下的预设与条件重来 */
  setInput(guid: string, input: Pick<TrackFilter, 'mode' | 'text' | 'advancedText'>): void;
  /** 马上按此刻的词、预设与条件求值，不等静默期（回车） */
  flush(guid: string): void;
  /** 勾上或取消一条预设，马上求值 */
  togglePreset(guid: string, id: PresetId): void;
  /** 勾上或取消一个分面值，马上求值 */
  toggleFacet(guid: string, facet: TrackFacet, name: string): void;
  /** 加一个条件，马上求值；已有的同一个条件、宿主写不出查询的条件不加 */
  addCondition(guid: string, condition: TrackCondition): void;
  removeCondition(guid: string, key: string): void;
  /** 清掉预设、分面与条件，词留着（条件行与筛选面板的「清除条件」） */
  clearConditions(guid: string): void;
  /** 输入、预设与条件整份换成给的，马上求值（后退回来时按快照恢复） */
  restore(guid: string, filter: TrackFilter): void;
  /** 词、预设与条件都清掉，退出过滤 */
  clear(guid: string): void;
  dispose(): void;
}

interface Entry {
  readonly guid: string;
  readonly own: PrimitiveAtom<PlaylistFilterState>;
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  contentVersion: number;
  tagVersion: number;
  closed: boolean;
  off: () => void;
}

/**
 * 播放列表页的临时筛选：把词、高级查询、常用预设与条件拼成一条 fb2k 查询（与歌曲页同一份合成），交宿主在这张
 * 列表上一次求值，只答命中的行号，再按页取这些行的数据，把表格收窄到命中的曲目。筛选只收窄显示，不写宿主，
 * 状态只在内存与页面快照里。命中取到 `MATCH_LIMIT` 就停
 *
 * 结果是一次求值的快照，输入不是：列表内容变了快照整份作废，还有要筛的就重算，框里的词、条件行与表格的
 * 过滤态始终对得上。重算期间表格停在过滤态等新结果，不闪回整张列表再收窄一次。求值失败按没有结果处理：
 * 快照清掉，词、预设与条件留着，下次列表变动再试
 */
export function startPlaylistFilter(
  store: Store,
  deps: PlaylistFilterDeps,
  host: PlaylistFilterFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
  storage?: PrefStorage | null,
): PlaylistFilterService {
  const prefs = startConfigPrefs(store, [SCOPE], host, writer);
  const surface = startPlaylistFilterSurface(store, storage);
  const slots = createSlots(NO_FILTER);
  let disposed = false;

  const read = (entry: Entry) => store.get(entry.own);
  /** 此刻框与预设、条件合成的查询；`filtered` 为假就是没有要筛的 */
  const queryOf = (entry: Entry) => trackQueryOf(trackFilterOf(read(entry)), store.get(SCOPE.atom));
  const update = (entry: Entry, patch: Partial<PlaylistFilterState>) => {
    if (!entry.closed) store.set(entry.own, { ...read(entry), ...patch });
  };

  function stopTimer(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  /** 丢掉快照。`keep` 为真时留在过滤态，重算期间表格不闪回整张列表 */
  function drop(entry: Entry, keep: boolean): void {
    entry.generation += 1;
    const { active, term } = read(entry);
    update(entry, {
      active: keep && active,
      term: keep ? term : '',
      scanning: false,
      truncated: false,
      hits: [],
      invalid: keep && read(entry).invalid,
    });
  }

  /**
   * 一次求值：宿主在整张列表上算，只答命中的行号；行数据按页取。宿主认不出高级查询时留着上一份命中只标出错，
   * 别的失败按没有结果处理。取行途中列表变了（两次答复的内容版本对不上）就重问，仍对不上不给结果，
   * 列表变动那一路会另起一轮
   */
  async function scan(entry: Entry): Promise<void> {
    stopTimer(entry);
    if (entry.closed || disposed) return;
    const built = queryOf(entry);
    if (!built.filtered) return;
    const generation = ++entry.generation;
    const stale = () => disposed || entry.closed || generation !== entry.generation;
    const { contentVersion, tagVersion } = store.get(deps.rows.stateOf(entry.guid));
    const term = queryInputText(trackFilterOf(read(entry))).trim();
    const stamp = deps.stamp();
    const failed = () =>
      update(entry, {
        active: false,
        term: '',
        scanning: false,
        truncated: false,
        hits: [],
        invalid: false,
      });
    update(entry, { scanning: true });
    for (let attempt = 0; attempt < QUERY_ATTEMPTS; attempt += 1) {
      const found = await settle(() => host.playlist.getMatchingRows(built.query, entry.guid));
      if (stale()) return;
      if (!found || found.success === false) {
        // 预设与条件由主题生成，宿主认不出只可能是框里写的高级查询
        if (found?.code === 'INVALID_PARAMS' && built.raw)
          update(entry, { scanning: false, invalid: true });
        else failed();
        return;
      }
      const hits: PlaylistHit[] = [];
      let truncated = false;
      let moved = false;
      for (let at = 0; at < found.items.length && !truncated; at += SCAN_PAGE) {
        const rows = found.items.slice(at, at + SCAN_PAGE);
        const page = await settle(() => host.playlist.getTracksAt(entry.guid, rows));
        if (stale()) return;
        if (!page || page.success === false) return failed();
        if (page.contentVersion !== found.contentVersion) {
          moved = true;
          break;
        }
        for (const track of page.tracks) {
          if (track.index === undefined) continue;
          if (hits.length >= MATCH_LIMIT) {
            truncated = true;
            break;
          }
          hits.push({ index: track.index, row: playlistRowOf(track) });
        }
      }
      if (moved) continue;
      // 取行途中前端那份行缓存也变了：快照对不上宿主，不给结果
      const currentRows = store.get(deps.rows.stateOf(entry.guid));
      if (currentRows.contentVersion !== contentVersion || currentRows.tagVersion !== tagVersion)
        return;
      update(entry, {
        active: true,
        term,
        scanning: false,
        truncated,
        hits,
        stamp,
        invalid: false,
      });
      return;
    }
  }

  /** 词、预设或条件变了之后：还有要筛的就马上算，一样都没有就退出过滤 */
  function refresh(entry: Entry): void {
    stopTimer(entry);
    if (queryOf(entry).filtered) void scan(entry);
    else drop(entry, false);
  }

  function onRows(entry: Entry): void {
    const { contentVersion, tagVersion } = store.get(deps.rows.stateOf(entry.guid));
    if (contentVersion === entry.contentVersion && tagVersion === entry.tagVersion) return;
    const moved = contentVersion !== entry.contentVersion;
    entry.contentVersion = contentVersion;
    entry.tagVersion = tagVersion;
    if (!queryOf(entry).filtered) return;
    // 行增删过，旧命中的行号对不上，先撤；只改了标签时旧命中留着显示，新一轮落地再换，不闪空
    if (moved) drop(entry, true);
    void scan(entry);
  }

  /**
   * 求值在宿主那边，任何一首的标签变了（评分、播放次数、最近播放也算）都可能改变命中，没法只看哪几首：
   * 等一会儿重算。已有定时（键入的静默期）时它到点就会算，不再另起
   */
  function onMetadb(): void {
    for (const [, entry] of holds.entries()) {
      if (entry.timer !== undefined || !queryOf(entry).filtered) continue;
      entry.timer = setTimeout(() => void scan(entry), TAGS_SETTLE_MS);
    }
  }

  const holds = createHolds<Entry>(
    (guid) => {
      const entry: Entry = {
        guid,
        own: slots.own(guid),
        generation: 0,
        timer: undefined,
        contentVersion: store.get(deps.rows.stateOf(guid)).contentVersion,
        tagVersion: store.get(deps.rows.stateOf(guid)).tagVersion,
        closed: false,
        off: () => {},
      };
      store.set(entry.own, NO_FILTER);
      entry.off = store.sub(deps.rows.stateOf(guid), () => onRows(entry));
      return entry;
    },
    (entry) => {
      entry.closed = true;
      entry.generation += 1;
      stopTimer(entry);
      entry.off();
      store.set(entry.own, NO_FILTER);
    },
  );

  /** 改这张列表的筛选，再马上算或退出过滤；这张没有页面在看就不理 */
  function change(guid: string, patch: Partial<PlaylistFilterState>): void {
    const entry = holds.get(guid);
    if (!entry) return;
    update(entry, patch);
    refresh(entry);
  }
  const stateOfHeld = (guid: string) => {
    const entry = holds.get(guid);
    return entry ? read(entry) : NO_FILTER;
  };

  // 宿主就绪后再订阅；释放时一起撤
  const waiter = waitForHost(host);
  let offMetadb = () => {};
  const subscribed = waiter.done.then((arrived) => {
    if (arrived && !disposed) offMetadb = host.on('metadb:changed', onMetadb);
  });

  return {
    ready: Promise.all([prefs.ready, subscribed]).then(() => {}),
    persistence: prefs,
    scopeAtom: SCOPE.atom,
    surface,
    setScope(scope) {
      if (disposed || scope === store.get(SCOPE.atom)) return;
      prefs.set(SCOPE, scope);
      for (const [, entry] of holds.entries()) {
        if (queryOf(entry).words.length === 0) continue;
        drop(entry, true);
        void scan(entry);
      }
    },
    stateOf: slots.view,
    acquire: (guid) => holds.acquire(guid),
    setInput(guid, input) {
      const entry = holds.get(guid);
      if (!entry) return;
      const was = read(entry);
      const before = queryInputText(trackFilterOf(was));
      update(entry, { mode: input.mode, query: input.text, advancedText: input.advancedText });
      const word = queryInputText(input).trim();
      // 只差首尾空白时词没变：已经算过或正在算，不再起一轮
      if (word === before.trim() && input.mode === was.mode && entry.timer === undefined) return;
      stopTimer(entry);
      if (word === '') refresh(entry);
      else entry.timer = setTimeout(() => void scan(entry), FILTER_DEBOUNCE_MS);
    },
    flush(guid) {
      const entry = holds.get(guid);
      if (entry) void scan(entry);
    },
    togglePreset(guid, id) {
      change(guid, { presets: togglePreset(stateOfHeld(guid).presets, id) });
    },
    toggleFacet(guid, facet, name) {
      change(guid, { facets: toggleTrackFacet(stateOfHeld(guid).facets, facet, name) });
    },
    addCondition(guid, condition) {
      if (conditionQuery(condition) === null) return;
      const { conditions } = stateOfHeld(guid);
      const key = conditionKey(condition);
      if (conditions.some((item) => conditionKey(item) === key)) return;
      change(guid, { conditions: [...conditions, condition] });
    },
    removeCondition(guid, key) {
      const { conditions } = stateOfHeld(guid);
      const next = conditions.filter((item) => conditionKey(item) !== key);
      if (next.length !== conditions.length) change(guid, { conditions: next });
    },
    clearConditions(guid) {
      const { presets, facets, conditions } = stateOfHeld(guid);
      if (presets.size > 0 || trackFacetCount(facets) > 0 || conditions.length > 0)
        change(guid, { presets: new Set(), facets: EMPTY_TRACK_FACETS, conditions: [] });
    },
    restore: (guid, filter) =>
      change(guid, {
        query: filter.text,
        mode: filter.mode,
        advancedText: filter.advancedText,
        presets: filter.presets,
        facets: filter.facets,
        conditions: filter.conditions,
      }),
    clear: (guid) =>
      change(guid, {
        query: '',
        advancedText: '',
        presets: new Set(),
        facets: EMPTY_TRACK_FACETS,
        conditions: [],
      }),
    dispose() {
      disposed = true;
      waiter.cancel();
      offMetadb();
      prefs.dispose();
      holds.dispose();
    },
  };
}
