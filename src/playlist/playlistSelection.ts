import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import {
  countRows,
  rangesOfRows,
  rowsOf,
  sameRanges,
  type SelectionRanges,
} from '../table/rangeSelection.ts';
import type { RowSelection } from '../table/rowSelection.ts';
import { startListIndex } from './playlistListIndex.ts';
import type { PlaylistRowsService } from './playlistRows.ts';

export interface PlaylistSelectionFace extends HostReadyFace {
  on: typeof fb.on;
  playlist: Pick<typeof fb.playlist, 'getSelection' | 'setSelection' | 'selectAll' | 'deselectAll'>;
}

export interface PlaylistSelectionDeps {
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
}

export interface PlaylistSelectionService {
  readonly ready: Promise<void>;
  /**
   * 页面把它那张表的选中交过来：本地一变就推给宿主，宿主那边变了写回来，行数跟着行服务。页面卸下时调
   * 返回的函数。
   */
  attach(guid: string, selection: RowSelection): () => void;
  /**
   * 等这张列表推给宿主的选中落地：在途与待发的都发完答真；这一轮失败、这张没在同步或服务已释放答假。
   * 按宿主那份选中执行的命令（移除、裁剪、「更多」）要先等它。
   */
  settle(guid: string): Promise<boolean>;
  /** 推或回查失败过：宿主那份可能与界面不一致。下一次成功时不自动收起，界面给关掉的入口。 */
  readonly failedAtom: Atom<boolean>;
  dismissFailure(): void;
  dispose(): void;
}

/** 待发的目标：`all` 走全选端点，`none` 走全不选，区间走 `setSelection`。 */
type Target = SelectionRanges | 'all' | 'none';

interface Sync {
  readonly guid: string;
  readonly selection: RowSelection;
  /** 本地每改一次加一：回查回来时本地又变过，那份结果就是旧的。 */
  generation: number;
  /** 按行服务哪一版内容回查过；-1 是还没回查过。 */
  contentVersion: number;
  pending: Target | null;
  sending: boolean;
  /** 最近一轮发送失败了；没发出去的目标留在 `pending`，`settle` 时重发。 */
  failed: boolean;
  settlers: ((synced: boolean) => void)[];
  /** 正在把宿主的那份或行数写进本地：这时的本地变化不推回去。 */
  applying: boolean;
  total: number;
  detached: boolean;
  offs: (() => void)[];
}

/**
 * 播放列表页的选中与宿主同步。选中同时是宿主状态：上下文菜单的 `selection` 模式、「移除」「裁剪」
 * 都按宿主那一份做，两边不一致时命令会作用在用户没看见的曲目上。所以本地每次变更都推给宿主，宿主那边
 * 被别处改了也回来同步。坐标一律是宿主的行号。
 *
 * 推送同时只有一个请求在途，途中来的新目标盖掉待发的那条：连按 Shift 加方向键时中间那些状态宿主不必
 * 看到。整张选满时走 `selectAll`，十万行不摊成一条十万个数字的消息。
 *
 * `selectionChanged` 只带列表序号，每次都回查一遍；自己推上去的那些也会引来事件，回查结果与本地相同就
 * 不写。回查途中本地变过、或还有没落地的推送，结果丢掉：它已经是旧的，写回来等于撤销用户刚做的选择，
 * 推送落地后宿主会再报一次。挂上时、行增删重排之后（宿主跟着挪了它那份）各回查一次。
 */
export function startPlaylistSelection(
  store: Store,
  deps: PlaylistSelectionDeps,
  host: PlaylistSelectionFace = fb,
): PlaylistSelectionService {
  let disposed = false;
  let connected = false;
  const failedAtom = atom(false);
  const syncs = new Set<Sync>();
  const waiter = waitForHost(host);
  const index = startListIndex(store, host);
  const offs: (() => void)[] = [];

  const fail = () => store.set(failedAtom, true);

  function finish(sync: Sync, synced: boolean): void {
    for (const resolve of sync.settlers.splice(0)) resolve(synced);
  }

  async function drain(sync: Sync): Promise<void> {
    if (sync.sending || !connected) return;
    sync.sending = true;
    sync.failed = false;
    while (sync.pending !== null && !sync.detached && !disposed) {
      const target = sync.pending;
      sync.pending = null;
      const { guid } = sync;
      const sent = await hostCommand(() =>
        target === 'all'
          ? host.playlist.selectAll(guid)
          : target === 'none'
            ? host.playlist.deselectAll(guid)
            : host.playlist.setSelection(guid, rowsOf(target), true),
      );
      if (!sent) {
        sync.failed = true;
        sync.pending ??= target;
        fail();
        break;
      }
    }
    sync.sending = false;
    finish(sync, !sync.failed && !sync.detached && !disposed);
  }

  function push(sync: Sync): void {
    const { ranges } = store.get(sync.selection.state);
    const count = countRows(ranges);
    sync.pending =
      count === 0 ? 'none' : count === sync.total && ranges[0]?.start === 0 ? 'all' : ranges;
    void drain(sync);
  }

  /** 把宿主的那份或行数写进本地，不推回去。 */
  function apply(sync: Sync, write: () => void): void {
    sync.applying = true;
    try {
      write();
    } finally {
      sync.applying = false;
    }
  }

  /** 回查宿主那一份。行还没取回过一页时不问：行数没定，写进来会被裁掉；取回时自会补问。 */
  async function reread(sync: Sync): Promise<void> {
    if (!connected || sync.detached) return;
    if (store.get(deps.rows.stateOf(sync.guid)).status !== 'ready') return;
    const generation = sync.generation;
    const answer = await settle(() => host.playlist.getSelection(sync.guid));
    if (disposed || sync.detached) return;
    if (!answer || answer.success === false) {
      // 列表已不在（刚删掉）答 NOT_FOUND：页面自己会显示已删除，不算同步失败。
      if (answer?.code !== 'NOT_FOUND') fail();
      return;
    }
    if (generation !== sync.generation || sync.sending || sync.pending !== null) return;
    followTotal(sync);
    const next = rangesOfRows(answer.items);
    if (!sameRanges(next, store.get(sync.selection.state).ranges)) {
      apply(sync, () => sync.selection.replace(next));
    }
  }

  /** 行数跟着行服务取回的那个数。第一页回来之前行数没定，不动本地。 */
  function followTotal(sync: Sync): void {
    const rows = store.get(deps.rows.stateOf(sync.guid));
    if (rows.status !== 'ready' || rows.total === sync.total) return;
    sync.total = rows.total;
    apply(sync, () => sync.selection.setTotal(rows.total));
  }

  /** 行第一次取回、或宿主那边行增删重排过（宿主跟着挪了它那份选中）：回查一次。 */
  function onRows(sync: Sync): void {
    followTotal(sync);
    const rows = store.get(deps.rows.stateOf(sync.guid));
    if (rows.status === 'ready' && rows.contentVersion !== sync.contentVersion) {
      sync.contentVersion = rows.contentVersion;
      void reread(sync);
    }
  }

  function follow(sync: Sync): () => void {
    const offRows = store.sub(deps.rows.stateOf(sync.guid), () => onRows(sync));
    const offLocal = store.sub(sync.selection.state, () => {
      if (sync.applying || sync.detached) return;
      sync.generation += 1;
      push(sync);
    });
    onRows(sync);
    return () => {
      offRows();
      offLocal();
    };
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    offs.push(
      host.on('playlist:selectionChanged', ({ playlist }) => {
        const guid = index.guidAt(playlist);
        for (const sync of syncs) if (guid === null || guid === sync.guid) void reread(sync);
      }),
    );
    connected = true;
    for (const sync of syncs) {
      if (sync.pending !== null) void drain(sync);
      else void reread(sync);
    }
  }

  return {
    ready: connect(),
    attach(guid, selection) {
      if (disposed) return () => {};
      const sync: Sync = {
        guid,
        selection,
        generation: 0,
        pending: null,
        sending: false,
        failed: false,
        settlers: [],
        applying: false,
        total: -1,
        contentVersion: -1,
        detached: false,
        offs: [],
      };
      syncs.add(sync);
      sync.offs.push(follow(sync));
      return () => {
        if (sync.detached) return;
        sync.detached = true;
        syncs.delete(sync);
        for (const off of sync.offs.splice(0)) off();
        finish(sync, false);
      };
    },
    settle(guid) {
      const sync = [...syncs].find((candidate) => candidate.guid === guid);
      if (!sync || disposed) return Promise.resolve(false);
      if (!sync.sending && sync.pending === null) return Promise.resolve(!sync.failed);
      const settled = new Promise<boolean>((resolve) => sync.settlers.push(resolve));
      void drain(sync);
      return settled;
    },
    failedAtom: atom((get) => get(failedAtom)),
    dismissFailure: () => store.set(failedAtom, false),
    dispose() {
      disposed = true;
      waiter.cancel();
      index.dispose();
      for (const off of offs.splice(0)) off();
      for (const sync of syncs) {
        sync.detached = true;
        for (const off of sync.offs.splice(0)) off();
        finish(sync, false);
      }
      syncs.clear();
    },
  };
}
