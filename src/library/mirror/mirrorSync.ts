import type { LibraryGetChangesSuccess } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import {
  LIBRARY_COALESCE_MS,
  onLibraryChanged,
  onLibraryStatsRefresh,
  type LibraryEventsFace,
} from '../../host/libraryContract.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';
import type { Store } from '../../kit/store.ts';
import { readMirrorTrack, type MirrorTrack } from '../../server/libraryMirrorProtocol.ts';
import type { MirrorClient } from './mirrorClient.ts';

/** 整库重建时每页向宿主请求的行数，与整库曲目的分页相同 */
const SEARCH_PAGE = 2000;
/** 增量读取时每批的句柄数。宿主读取一个约需 0.25 ms，200 个约需 50 ms */
const TRACK_BATCH = 200;
/** 一次对账中变化的曲目超过该数时整库重建，不再逐批读取 */
const REBUILD_ABOVE = 3000;
/** 一次同步最多对账的轮数。达到上限仍未追平，说明媒体库持续变化，稍后再同步 */
const MAX_ROUNDS = 20;
const PENDING_RETRY_MS = 2000;
const FAILURE_RETRY_MS = 30000;
/** 多个窗口中，只有持有这把锁的窗口执行同步 */
const LOCK_NAME = 'default-theme.library-mirror';

export interface MirrorSyncFace extends HostReadyFace, LibraryEventsFace {
  library: Pick<typeof fb.library, 'getChanges' | 'getTracks' | 'search'>;
}

/** 同步用到的 `navigator.locks` 方法 */
export interface MirrorLocks {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
}

export interface MirrorSyncDeps {
  readonly client: MirrorClient;
  /** 本地后端是否已连接，取自 `BackendConnection.port` */
  readonly connected: Atom<boolean>;
  readonly host?: MirrorSyncFace;
  /** 窗口之间的锁，省略时使用 `navigator.locks`。没有可用的锁或传入 null 时，视为唯一的窗口 */
  readonly locks?: MirrorLocks | null;
}

/**
 * 同步阶段：
 * - `idle`：尚未同步，或在等待宿主的媒体库加载完成
 * - `syncing`：正在对账或重建
 * - `ready`：上一次对账时镜像已与宿主一致
 * - `failed`：最近一次同步出错，镜像不可信，稍后自动重试
 */
export type MirrorSyncPhase = 'idle' | 'syncing' | 'ready' | 'failed';

export interface MirrorSyncState {
  readonly phase: MirrorSyncPhase;
  /** 本窗口是否负责同步 */
  readonly leader: boolean;
  readonly epoch: string;
  readonly revision: number;
  readonly count: number;
  /** 镜像内容每写入一次加一，读取方据此重新读取 */
  readonly generation: number;
}

export interface LibraryMirrorSync {
  readonly state: Atom<MirrorSyncState>;
  /** 对账一次：追平宿主的修订号，必要时整库重建。同时发起的多次调用合并为一次，本窗口不负责同步或后端未连接时不执行 */
  sync(): Promise<void>;
  dispose(): void;
}

const INITIAL: MirrorSyncState = {
  phase: 'idle',
  leader: false,
  epoch: '',
  revision: 0,
  count: 0,
  generation: 0,
};

function defaultLocks(): MirrorLocks | null {
  const locks: LockManager | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ?? null;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

function validRow(raw: unknown): MirrorTrack {
  const track = readMirrorTrack(raw);
  if (!track) throw new Error('宿主的曲目行不合格');
  return track;
}

/**
 * 把宿主的媒体库同步到本地后端的镜像。只有页面能访问宿主，因此同步在页面中执行。
 * 多个窗口经 `navigator.locks` 只保留一个同步者。四种媒体库事件按 1 秒合并后触发对账：
 * - 镜像已存在且纪元一致：`getChanges` 读取差量，`getTracks` 逐批读取变化的行，连同新修订号在一个请求中写入
 * - 其他情况（从未建立、纪元变化、修订号超出宿主的记录范围、变化过多）整库重建：`search` 翻页读取行，
 *   再按 `resync` 返回的全部句柄补读翻页时遗漏的行，最后用该应答的修订号收尾。重建期间镜像不可读，读取方照常读取宿主
 * 宿主的媒体库仍在加载（`OPERATION_PENDING`）时稍后重试。出错时记为 `failed`，间隔一段时间后自动重试
 */
export function startMirrorSync(store: Store, deps: MirrorSyncDeps): LibraryMirrorSync {
  const { client, connected } = deps;
  const host = deps.host ?? fb;
  const locks = deps.locks === undefined ? defaultLocks() : deps.locks;
  const state = atom<MirrorSyncState>(INITIAL);
  const waiter = waitForHost(host);
  let disposed = false;
  let leader = false;
  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offLibrary: (() => void) | undefined;
  let offStats: (() => void) | undefined;
  let releaseLock: (() => void) | undefined;

  const patch = (change: Partial<MirrorSyncState>) =>
    store.set(state, { ...store.get(state), ...change });
  const wrote = () => patch({ generation: store.get(state).generation + 1 });

  function schedule(delay: number): void {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void sync();
    }, delay);
  }

  async function changesSince(params: {
    epoch?: string;
    since?: number;
  }): Promise<LibraryGetChangesSuccess | 'pending'> {
    const answer = await settle(() => host.library.getChanges(params));
    if (!answer) throw new Error('宿主没有答复媒体库变更');
    if (answer.success === false) {
      if (answer.code === 'OPERATION_PENDING') return 'pending';
      throw new Error(answer.error);
    }
    return answer;
  }

  async function fetchRows(handles: readonly string[]) {
    const rows: MirrorTrack[] = [];
    const missing: string[] = [];
    for (const batch of batches(handles, TRACK_BATCH)) {
      const answer = await settle(() => host.library.getTracks(batch));
      if (!answer || answer.success === false) throw new Error('宿主没有答复曲目行');
      rows.push(...answer.tracks.map(validRow));
      missing.push(...answer.missing);
    }
    return { rows, missing };
  }

  async function rebuild(resync: LibraryGetChangesSuccess): Promise<void> {
    const generation = await client.rebuildBegin();
    const seen = new Set<string>();
    let fetched = 0;
    // 写入后端与读取下一页并行进行，但同一时刻只有一批在写入
    let writing: Promise<void> = Promise.resolve();
    const write = async (rows: MirrorTrack[], indexFrom: number): Promise<void> => {
      await writing;
      const current = client.rebuildPut(generation, rows, indexFrom);
      current.catch(() => {});
      writing = current;
    };
    for (;;) {
      const page = await settle(() => host.library.search('ALL', SEARCH_PAGE, { offset: fetched }));
      if (disposed) return;
      if (!page || page.success === false) throw new Error('宿主没有答复整库曲目');
      const rows = page.tracks.map(validRow);
      for (const row of rows) seen.add(row.handle);
      await write(rows, fetched);
      fetched += rows.length;
      if (rows.length === 0 || fetched >= page.total) break;
    }
    let tail = fetched;
    for (const batch of batches(
      (resync.handles ?? []).filter((handle) => !seen.has(handle)),
      TRACK_BATCH,
    )) {
      const { rows } = await fetchRows(batch);
      await write(rows, tail);
      tail += rows.length;
    }
    await writing;
    if (disposed) return;
    await client.rebuildCommit(generation, resync.epoch, resync.revision);
    wrote();
  }

  async function run(): Promise<void> {
    let rebuilt = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (disposed) return;
      const status = await client.status();
      const known = status.ready && status.epoch !== '';
      const answer = await changesSince(
        known ? { epoch: status.epoch, since: status.revision } : {},
      );
      if (answer === 'pending') {
        patch({ phase: 'idle' });
        schedule(PENDING_RETRY_MS);
        return;
      }
      const changed = answer.changed ?? [];
      const removed = answer.removed ?? [];
      if (answer.resync || changed.length + removed.length > REBUILD_ABOVE) {
        // 刚重建完宿主仍要求重建（媒体库被停用，或持续大量变化）时，继续重建没有意义
        if (rebuilt) throw new Error('宿主在重建之后仍要求重建');
        rebuilt = true;
        const resync = answer.resync ? answer : await changesSince({});
        if (resync === 'pending') {
          patch({ phase: 'idle' });
          schedule(PENDING_RETRY_MS);
          return;
        }
        await rebuild(resync);
        continue;
      }
      if (changed.length + removed.length === 0 && answer.revision === status.revision) {
        patch({
          phase: 'ready',
          epoch: status.epoch,
          revision: status.revision,
          count: status.count,
        });
        return;
      }
      const { rows, missing } = await fetchRows(changed);
      const reply = await client.apply({
        epoch: answer.epoch,
        since: status.revision,
        revision: answer.revision,
        upsert: rows,
        remove: [...removed, ...missing],
      });
      if (!reply.stale) wrote();
    }
    schedule(LIBRARY_COALESCE_MS);
  }

  async function attempt(): Promise<void> {
    if (!leader || !store.get(connected) || !(await waiter.done) || disposed) return;
    patch({ phase: 'syncing' });
    try {
      await run();
    } catch {
      if (disposed) return;
      patch({ phase: 'failed' });
      schedule(FAILURE_RETRY_MS);
    }
  }

  function sync(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await attempt();
      } while (again && !disposed);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function lead(): void {
    leader = true;
    patch({ leader: true });
    schedule(0);
  }

  if (locks) {
    void locks
      .request(
        LOCK_NAME,
        () =>
          new Promise<void>((resolve) => {
            if (disposed) return resolve();
            releaseLock = resolve;
            lead();
          }),
      )
      .catch(() => {});
  } else lead();
  const offConnected = store.sub(connected, () => schedule(0));
  void waiter.done.then((arrived) => {
    if (!arrived || disposed) return;
    offLibrary = onLibraryChanged(host, () => schedule(LIBRARY_COALESCE_MS));
    // 播放统计的刷新也会推进宿主修订号。及时追平，重启后才能继续增量同步
    offStats = onLibraryStatsRefresh(host, () => schedule(LIBRARY_COALESCE_MS));
    schedule(0);
  });

  return {
    state: atom((get) => get(state)),
    sync,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      offLibrary?.();
      offStats?.();
      offConnected();
      waiter.cancel();
      releaseLock?.();
    },
  };
}
