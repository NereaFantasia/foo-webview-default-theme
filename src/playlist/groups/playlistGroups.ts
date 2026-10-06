import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import { browserStorage, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import type { GroupRun } from './groupLayout.ts';
import { readGroupsPrefs, writeGroupsPrefs, type GroupsPrefs } from './playlistGroupsPrefs.ts';
import { createHolds, createSlots } from '../playlistHolds.ts';
import type { PlaylistRowsService } from '../playlistRows.ts';
import { DEFAULT_GROUP_MODE, GROUP_MODES } from '../sortPatterns.ts';

/** 行变了到重取游程之间的合并窗口，毫秒。 */
export const GROUPS_COALESCE_MS = 150;
/**
 * 接受的一级游程数上限。宿主不截断游程，分组键接近逐行不同时组头与载荷都会很多；超限时不留这份游程，
 * 带提示退回扁平列表。
 */
export const MAX_RUNS = 10_000;
/** 游程与一页的总数对不上说明列表正在变：重取这么多次仍对不上就先不分组，等下一次变化。 */
const MAX_RESYNC = 2;

/** 退回扁平时带的提示：宿主取不到游程，或组太多。列表正在变这类一时的情况不提示。 */
export type GroupsFailure = 'unavailable' | 'tooMany';

export interface PlaylistGroupsState {
  /** 这张列表的游程；不分组、没取到或降级了时为空，表格据此走扁平。 */
  readonly runs: readonly GroupRun[];
  readonly total: number;
  /** 在等游程：表格先按旧的样子画，不在游程与行之间来回跳。 */
  readonly loading: boolean;
  readonly failure: GroupsFailure | null;
  /** 折起来的一级组键。只在内存里记、不落盘，页面放手这张列表后就清掉。 */
  readonly collapsed: ReadonlySet<string>;
}

export const NO_GROUPS: PlaylistGroupsState = {
  runs: [],
  total: 0,
  loading: false,
  failure: null,
  collapsed: new Set(),
};

export interface PlaylistGroupsFace extends HostReadyFace {
  playlist: Pick<typeof fb.playlist, 'getGroupRuns' | 'getTracks' | 'sort'>;
}

export interface PlaylistGroupsDeps {
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
  /** 不给时用页面的 localStorage。 */
  readonly storage?: PrefStorage | null;
}

export interface PlaylistGroupsService {
  readonly ready: Promise<void>;
  readonly prefsAtom: Atom<GroupsPrefs>;
  /** 一张列表的分组；同一 GUID 总是同一个原子，没有页面要它时是 `NO_GROUPS`。 */
  stateOf(guid: string): Atom<PlaylistGroupsState>;
  /** 页面挂上时调，开始取这张的游程；返回的函数在卸下时调。 */
  acquire(guid: string): () => void;
  toggleCollapsed(guid: string, key: string): void;
  collapseAll(guid: string): void;
  expandAll(guid: string): void;
  /**
   * 换分组依据：先让宿主按这一档重排这张列表，再取游程。游程只认相邻的行，顺序不对就碎成一堆单曲组。
   * 重排被拒（列表锁着）时照样换档重取，组按现有顺序算，碎一点但不是错的。
   */
  setMode(guid: string, mode: number): Promise<void>;
  setEnabled(enabled: boolean): void;
  retry(guid: string): void;
  dismissFailure(guid: string): void;
  dispose(): void;
}

interface Entry {
  readonly guid: string;
  readonly own: PrimitiveAtom<PlaylistGroupsState>;
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** 换档时发出的重排：取游程要等它答了，否则取到的是重排之前的顺序。 */
  sorting: Promise<unknown>;
  /** 按行服务哪一版内容取过游程；-1 是还没取过。 */
  contentVersion: number;
  closed: boolean;
  off: () => void;
}

/**
 * 播放列表页的分组游程：取它、维护它的新鲜度，只此两件；行归行服务，游程只给边界、不带行数据。
 *
 * 不自己订阅宿主事件：行服务已经把内容事件收成 `contentVersion`，这里跟着它走，按
 * `GROUPS_COALESCE_MS` 合并。`itemsReordered` 不改总数却改分组边界，弱版本拦不住，只能靠它重取。
 * 游程与同刻取的一页总数对不上，说明列表在两次读之间变了，重取有限次。
 *
 * 任何一步走不通都退回扁平，而不是把整页判失败：列表本身读得到，分组只是它的一层视图。退回时带提示，
 * 不静默。折叠状态也放这里：它按组键记，组键的生死由这一份游程定；重取时只丢已经不在的键，随便加一首
 * 歌不会把折起来的组全展开。
 */
export function startPlaylistGroups(
  store: Store,
  deps: PlaylistGroupsDeps,
  host: PlaylistGroupsFace = fb,
): PlaylistGroupsService {
  const storage = deps.storage === undefined ? browserStorage() : deps.storage;
  const prefs = atom<GroupsPrefs>(readGroupsPrefs(storage));
  const slots = createSlots(NO_GROUPS);
  const waiter = waitForHost(host);
  let connected = false;
  let disposed = false;

  const read = (entry: Entry) => store.get(entry.own);
  const update = (entry: Entry, patch: Partial<PlaylistGroupsState>) => {
    if (!entry.closed) store.set(entry.own, { ...read(entry), ...patch });
  };

  const persist = () => writeGroupsPrefs(storage, store.get(prefs));

  function stopTimer(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  /** 退回扁平；`failure` 为 null 是列表正在变这类一时的情况，不打扰用户。 */
  function degrade(entry: Entry, failure: GroupsFailure | null): void {
    update(entry, { runs: [], total: 0, loading: false, failure });
  }

  /** 排一次取游程；`delay` 是合并窗口，页面刚挂上的第一次不等。 */
  function schedule(entry: Entry, resync = 0, delay = GROUPS_COALESCE_MS): void {
    if (entry.closed || disposed) return;
    stopTimer(entry);
    if (!store.get(prefs).enabled) {
      update(entry, { runs: [], total: 0, loading: false, failure: null });
      return;
    }
    update(entry, { loading: true });
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void load(entry, resync);
    }, delay);
  }

  async function load(entry: Entry, resync: number): Promise<void> {
    if (!connected) return;
    const generation = ++entry.generation;
    const stale = () => disposed || entry.closed || generation !== entry.generation;
    await entry.sorting;
    if (stale()) return;
    const mode = GROUP_MODES[store.get(prefs).mode] ?? GROUP_MODES[DEFAULT_GROUP_MODE];
    const patterns = [...(mode?.patterns ?? [])];
    // 两次读尽量同刻：弱版本比的就是它们之间列表有没有动。页只取一行、只投影 index。
    const [grouped, page] = await Promise.all([
      settle(() => host.playlist.getGroupRuns(patterns, entry.guid)),
      settle(() => host.playlist.getTracks(entry.guid, 0, 1, undefined, ['index'])),
    ]);
    if (stale()) return;
    if (!grouped || grouped.success === false) {
      // 列表已不在：页面自己显示已删除，这里不再添一条提示。
      degrade(entry, grouped?.code === 'NOT_FOUND' ? null : 'unavailable');
      return;
    }
    if (!page || page.success === false || page.total !== grouped.total) {
      if (resync < MAX_RESYNC) schedule(entry, resync + 1);
      else degrade(entry, null);
      return;
    }
    if (grouped.runs.length > MAX_RUNS) {
      degrade(entry, 'tooMany');
      return;
    }
    const living = new Set(grouped.runs.map((run) => run.key));
    const { collapsed } = read(entry);
    const kept = [...collapsed].filter((key) => living.has(key));
    update(entry, {
      runs: grouped.runs,
      total: grouped.total,
      loading: false,
      failure: null,
      collapsed: kept.length === collapsed.size ? collapsed : new Set(kept),
    });
  }

  /** 行增删重排过：重取游程。列表删了就收起分组。 */
  function onRows(entry: Entry): void {
    const rows = store.get(deps.rows.stateOf(entry.guid));
    if (rows.status === 'gone') {
      stopTimer(entry);
      entry.generation += 1;
      degrade(entry, null);
      return;
    }
    if (rows.contentVersion === entry.contentVersion) return;
    entry.contentVersion = rows.contentVersion;
    entry.generation += 1;
    schedule(entry);
  }

  /**
   * 页面刚挂上：马上取第一份游程，与行服务取第一页并行。游程自带一页总数核对，不必等行先到；组头与封面
   * 都等游程，串在第一页后面、再等一个合并窗口，进页后封面要晚到好一截。
   */
  function first(entry: Entry): void {
    entry.contentVersion = store.get(deps.rows.stateOf(entry.guid)).contentVersion;
    entry.generation += 1;
    schedule(entry, 0, 0);
  }

  const holds = createHolds<Entry>(
    (guid) => {
      const entry: Entry = {
        guid,
        own: slots.own(guid),
        generation: 0,
        timer: undefined,
        sorting: Promise.resolve(),
        contentVersion: -1,
        closed: false,
        off: () => {},
      };
      store.set(entry.own, NO_GROUPS);
      entry.off = store.sub(deps.rows.stateOf(guid), () => onRows(entry));
      if (store.get(deps.rows.stateOf(guid)).status === 'gone') onRows(entry);
      else first(entry);
      return entry;
    },
    (entry) => {
      entry.closed = true;
      entry.generation += 1;
      stopTimer(entry);
      entry.off();
      store.set(entry.own, NO_GROUPS);
    },
  );
  const entries = () => holds.entries().map(([, entry]) => entry);

  function collapse(guid: string, change: (current: ReadonlySet<string>) => ReadonlySet<string>) {
    const entry = holds.get(guid);
    if (entry) update(entry, { collapsed: change(read(entry).collapsed) });
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    connected = true;
    for (const entry of entries()) if (entry.contentVersion >= 0) schedule(entry);
  }

  return {
    ready: connect(),
    prefsAtom: atom((get) => get(prefs)),
    stateOf: slots.view,
    acquire: (guid) => holds.acquire(guid),
    toggleCollapsed(guid, key) {
      collapse(guid, (current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    },
    collapseAll(guid) {
      const entry = holds.get(guid);
      if (entry && read(entry).runs.length > 0) {
        update(entry, { collapsed: new Set(read(entry).runs.map((run) => run.key)) });
      }
    },
    expandAll(guid) {
      collapse(guid, (current) => (current.size > 0 ? new Set() : current));
    },
    async setMode(guid, mode) {
      const current = store.get(prefs);
      if (disposed || GROUP_MODES[mode] === undefined || current.mode === mode) return;
      store.set(prefs, { ...current, mode });
      persist();
      const sort = GROUP_MODES[mode]?.sort ?? '';
      const sorting = connected ? settle(() => host.playlist.sort(guid, sort, false)) : null;
      for (const entry of entries()) {
        entry.generation += 1;
        if (entry.guid === guid && sorting) entry.sorting = sorting;
        update(entry, { runs: [], total: 0, collapsed: new Set() });
        schedule(entry);
      }
      await sorting;
    },
    setEnabled(enabled) {
      const current = store.get(prefs);
      if (disposed || current.enabled === enabled) return;
      store.set(prefs, { ...current, enabled });
      persist();
      for (const entry of entries()) {
        entry.generation += 1;
        schedule(entry);
      }
    },
    retry(guid) {
      const entry = holds.get(guid);
      if (!entry) return;
      update(entry, { failure: null });
      schedule(entry);
    },
    dismissFailure(guid) {
      const entry = holds.get(guid);
      if (entry) update(entry, { failure: null });
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      holds.dispose();
    },
  };
}
