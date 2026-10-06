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
import type { Store } from '../../kit/store.ts';
import { createHolds, createSlots } from '../playlistHolds.ts';
import {
  COMMENT_FORMAT,
  FILTER_SCOPES,
  filterWords,
  rowMatcher,
  sameCondition,
  type FilterScope,
  type PlaylistCondition,
} from './playlistMatch.ts';
import { playlistRowOf, ROW_FIELDS, type PlaylistRow } from '../playlistRow.ts';
import type { PlaylistRowsService } from '../playlistRows.ts';

/** 一次扫描向宿主要多少行。 */
export const SCAN_PAGE = 200;
/** 命中上限：十页的量级，够翻看，也挡住「搜一个 a 就把十万行搬进内存」。 */
export const MATCH_LIMIT = 2000;
/** 键入到开始扫描的静默期，毫秒：每次扫描都要翻页取整张列表，连着敲不该连着扫。 */
export const FILTER_DEBOUNCE_MS = 300;

// 键名沿用已发布的版本，用户上次选的那一档原样读回；新加的几档旧版本读到时退回「全部字段」。
const SCOPE = defineConfigPref<FilterScope>(
  'defaultTheme.searchScope',
  'all',
  oneOf(FILTER_SCOPES),
);

export interface PlaylistHit {
  /** 在列表里的行号。 */
  readonly index: number;
  readonly row: PlaylistRow;
}

export interface PlaylistFilterState {
  /**
   * 输入框里的原文，给了就写，首尾空白也留着：受控的输入框按它显示，逐字敲到词间的空格时不能被吃掉。
   * 扫描用的是从它切出来的词（`filterWords`），一个词都没有时只看条件。
   */
  readonly query: string;
  /** 条件，给了就写，条件行照它画；与词同时生效。 */
  readonly conditions: readonly PlaylistCondition[];
  /** 表格在过滤态：扫描落地才为真，与 `hits` 同步。为假时表格照常显示整张列表。 */
  readonly active: boolean;
  /** 落地的这一份扫描用的原文（已去首尾空白），没有词时是空串。 */
  readonly term: string;
  readonly scanning: boolean;
  /** 命中数到了上限，后面的没再找。 */
  readonly truncated: boolean;
  /** 命中的行，按列表顺序。 */
  readonly hits: readonly PlaylistHit[];
  /** 这批命中取数之前拿的评分戳，见 `TrackRatingsService.stamp`。 */
  readonly stamp: number;
}

export const NO_FILTER: PlaylistFilterState = {
  query: '',
  conditions: [],
  active: false,
  term: '',
  scanning: false,
  truncated: false,
  hits: [],
  stamp: 0,
};

export interface PlaylistFilterFace extends ConfigPrefFace {
  playlist: Pick<typeof fb.playlist, 'getTracks'>;
}

export interface PlaylistFilterDeps {
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
  /** 评分服务的戳：每次扫描开始之前拿一次。 */
  readonly stamp: () => number;
}

export interface PlaylistFilterService {
  readonly persistence: ConfigPersistence;
  readonly ready: Promise<void>;
  /** 字段范围，随 profile 记住。 */
  readonly scopeAtom: Atom<FilterScope>;
  setScope(scope: FilterScope): void;
  /** 一张列表的过滤；同一 GUID 总是同一个原子，没有页面要它时是 `NO_FILTER`。 */
  stateOf(guid: string): Atom<PlaylistFilterState>;
  acquire(guid: string): () => void;
  /** 键入：词先记下，静默 `FILTER_DEBOUNCE_MS` 后扫描；词清空了马上按剩下的条件重来。 */
  setQuery(guid: string, text: string): void;
  /** 马上按此刻的词与条件扫描，不等静默期（回车）。 */
  flush(guid: string): void;
  /** 清掉词，条件留着（过滤框的 ✕ 与 Esc）。 */
  clearQuery(guid: string): void;
  /** 加一个条件，马上扫描；已有的同一个条件不再加。 */
  addCondition(guid: string, condition: PlaylistCondition): void;
  removeCondition(guid: string, condition: PlaylistCondition): void;
  /** 清掉条件，词留着（条件行的「清除条件」）。 */
  clearConditions(guid: string): void;
  /** 词与条件整份换成给的，马上扫描（后退回来时按快照恢复）。 */
  restore(guid: string, query: string, conditions: readonly PlaylistCondition[]): void;
  /** 词与条件都清掉，退出过滤。 */
  clear(guid: string): void;
  dispose(): void;
}

interface Entry {
  readonly guid: string;
  readonly own: PrimitiveAtom<PlaylistFilterState>;
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  contentVersion: number;
  closed: boolean;
  off: () => void;
}

/**
 * 播放列表页的过滤：按词与条件把表格收窄到命中的曲目。词大小写不敏感、几个都要命中，每个词在字段范围里
 * 的某个字段里出现就算；条件比整个值。过滤在前端做，一次扫描按 `SCAN_PAGE` 翻页读完整张列表，命中到了
 * `MATCH_LIMIT` 就停。结果带行数据，过滤态的显示与评分直接用它，不依赖行服务的页缓存。
 *
 * 结果是一次扫描的快照，词与条件不是：列表内容变了快照整份作废，还有词或条件就重扫一遍，框里的词、
 * 条件行与表格的过滤态始终对得上。重扫期间表格停在过滤态等新结果，不闪回整张列表再收窄一次。扫描失败按
 * 没有结果处理：快照清掉，词与条件留着，下次列表变动再试。
 */
export function startPlaylistFilter(
  store: Store,
  deps: PlaylistFilterDeps,
  host: PlaylistFilterFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): PlaylistFilterService {
  const prefs = startConfigPrefs(store, [SCOPE], host, writer);
  const slots = createSlots(NO_FILTER);
  let disposed = false;

  const read = (entry: Entry) => store.get(entry.own);
  const wordsOf = (entry: Entry) => filterWords(read(entry).query);
  /** 有没有要过滤的：有词或有条件。 */
  const wanted = (entry: Entry) => wordsOf(entry).length > 0 || read(entry).conditions.length > 0;
  const update = (entry: Entry, patch: Partial<PlaylistFilterState>) => {
    if (!entry.closed) store.set(entry.own, { ...read(entry), ...patch });
  };

  function stopTimer(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  /** 丢掉快照。`keep` 为真时留在过滤态，重扫期间表格不闪回整张列表。 */
  function drop(entry: Entry, keep: boolean): void {
    entry.generation += 1;
    const { active, term } = read(entry);
    update(entry, {
      active: keep && active,
      term: keep ? term : '',
      scanning: false,
      truncated: false,
      hits: [],
    });
  }

  async function scan(entry: Entry): Promise<void> {
    stopTimer(entry);
    if (entry.closed || disposed || !wanted(entry)) return;
    const generation = ++entry.generation;
    const contentVersion = store.get(deps.rows.stateOf(entry.guid)).contentVersion;
    const stale = () => disposed || entry.closed || generation !== entry.generation;
    const { query, conditions } = read(entry);
    const words = filterWords(query);
    const scope = store.get(SCOPE.atom);
    const matches = rowMatcher(words, scope, conditions);
    const formats = scope === 'comment' && words.length > 0 ? { ...COMMENT_FORMAT } : undefined;
    const stamp = deps.stamp();
    const hits: PlaylistHit[] = [];
    let truncated = false;
    update(entry, { scanning: true });
    for (let offset = 0; !truncated; offset += SCAN_PAGE) {
      const page = await settle(() =>
        host.playlist.getTracks(entry.guid, offset, SCAN_PAGE, formats, [...ROW_FIELDS]),
      );
      if (stale()) return;
      if (!page || page.success === false) {
        update(entry, { active: false, term: '', scanning: false, truncated: false, hits: [] });
        return;
      }
      for (const [at, track] of page.tracks.entries()) {
        const row = playlistRowOf(track);
        if (!matches(row, track.formats ?? {})) continue;
        if (hits.length >= MATCH_LIMIT) {
          truncated = true;
          break;
        }
        hits.push({ index: offset + at, row });
      }
      // 短页即表尾。
      if (page.tracks.length < SCAN_PAGE) break;
    }
    // 扫描途中内容变了：快照已经对不上宿主，宁可不给结果；内容变化那一路会另起一轮。
    if (store.get(deps.rows.stateOf(entry.guid)).contentVersion !== contentVersion) return;
    update(entry, { active: true, term: query.trim(), scanning: false, truncated, hits, stamp });
  }

  /** 词或条件变了之后：还有要过滤的就马上扫，一样都没有就退出过滤。 */
  function refresh(entry: Entry): void {
    stopTimer(entry);
    if (wanted(entry)) void scan(entry);
    else drop(entry, false);
  }

  function onRows(entry: Entry): void {
    const { contentVersion } = store.get(deps.rows.stateOf(entry.guid));
    if (contentVersion === entry.contentVersion) return;
    entry.contentVersion = contentVersion;
    if (!wanted(entry)) return;
    drop(entry, true);
    void scan(entry);
  }

  const holds = createHolds<Entry>(
    (guid) => {
      const entry: Entry = {
        guid,
        own: slots.own(guid),
        generation: 0,
        timer: undefined,
        contentVersion: store.get(deps.rows.stateOf(guid)).contentVersion,
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

  /** 改这张列表的词或条件，再马上扫或退出过滤；这张没有页面在看就不理。 */
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

  return {
    ready: prefs.ready,
    persistence: prefs,
    scopeAtom: SCOPE.atom,
    setScope(scope) {
      if (disposed || scope === store.get(SCOPE.atom)) return;
      prefs.set(SCOPE, scope);
      for (const [, entry] of holds.entries()) {
        if (wordsOf(entry).length === 0) continue;
        drop(entry, true);
        void scan(entry);
      }
    },
    stateOf: slots.view,
    acquire: (guid) => holds.acquire(guid),
    setQuery(guid, text) {
      const entry = holds.get(guid);
      if (!entry) return;
      const before = read(entry).query.trim();
      update(entry, { query: text });
      const word = text.trim();
      // 只差首尾空白时词没变：已经扫过或正在扫，不再起一轮。
      if (word === before && entry.timer === undefined) return;
      stopTimer(entry);
      if (word === '') refresh(entry);
      else entry.timer = setTimeout(() => void scan(entry), FILTER_DEBOUNCE_MS);
    },
    flush(guid) {
      const entry = holds.get(guid);
      if (entry) void scan(entry);
    },
    clearQuery(guid) {
      if (stateOfHeld(guid).query !== '') change(guid, { query: '' });
    },
    addCondition(guid, condition) {
      const { conditions } = stateOfHeld(guid);
      if (conditions.some((item) => sameCondition(item, condition))) return;
      change(guid, { conditions: [...conditions, condition] });
    },
    removeCondition(guid, condition) {
      const { conditions } = stateOfHeld(guid);
      const next = conditions.filter((item) => !sameCondition(item, condition));
      if (next.length !== conditions.length) change(guid, { conditions: next });
    },
    clearConditions(guid) {
      if (stateOfHeld(guid).conditions.length > 0) change(guid, { conditions: [] });
    },
    restore: (guid, query, conditions) => change(guid, { query, conditions }),
    clear: (guid) => change(guid, { query: '', conditions: [] }),
    dispose() {
      disposed = true;
      prefs.dispose();
      holds.dispose();
    },
  };
}
