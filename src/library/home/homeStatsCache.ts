import type { LibraryTrack } from 'foo-webview-sdk';
import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';
import { trackPathOf } from '../../host/libraryContract.ts';
import type { BackendConnection } from '../../server/backendConnection.ts';
import {
  LIBRARY_STATS_PAGE,
  readLibraryStatsPage,
  readLibraryStatsStatus,
  type LibraryStatsRow,
  type LibraryStatsStatus,
} from '../../server/libraryStatsProtocol.ts';

interface StatsSnapshot {
  epoch: string;
  revision: number;
  readonly rows: Map<string, LibraryStatsRow>;
  status: LibraryStatsStatus | null;
  reset: boolean;
  readonly changed: Set<string>;
  readonly removed: Set<string>;
}

export interface HomeStatsRead {
  readonly rows: Map<string, LibraryStatsRow>;
  readonly pending: readonly LibraryTrack[];
}

/** 创建首页的播放统计缓存，保存逐曲统计与宿主修订号。读取中断时保留已读完的行，下一轮只补读缺失与变化的曲目 */
export function createHomeStatsCache(
  host: Pick<typeof fb, 'library'>,
  backend: Pick<BackendConnection, 'request'> | undefined,
  connected: () => boolean,
) {
  let snapshot: StatsSnapshot | undefined;
  const request = async (action: string, body?: unknown): Promise<unknown> => {
    if (!backend || !connected()) throw new Error('统计缓存未连接');
    return backend.request(`/library/stats-${action}`, body, { timeoutMs: 5000 });
  };

  async function restore(
    status: LibraryStatsStatus,
    current: () => boolean,
  ): Promise<StatsSnapshot | undefined> {
    const rows = new Map<string, LibraryStatsRow>();
    if (status.ready) {
      let after = '';
      for (;;) {
        if (!current()) return undefined;
        const page = readLibraryStatsPage(
          await request('page', { generation: status.generation, after }),
        );
        if (!page || !current()) return undefined;
        for (const row of page.rows) rows.set(row.handle, row);
        if (page.next === null) break;
        if (page.next === after) return undefined;
        after = page.next;
      }
    }
    return {
      ...status,
      rows,
      status,
      reset: !status.ready,
      changed: new Set(),
      removed: new Set(),
    };
  }

  return {
    async read(tracks: readonly LibraryTrack[], current: () => boolean): Promise<HomeStatsRead> {
      if (connected()) {
        try {
          const status = readLibraryStatsStatus(await request('status'));
          if (status && current() && status.generation !== snapshot?.status?.generation) {
            const restored = await restore(status, current);
            if (current()) snapshot = restored;
          }
        } catch {
          /* 无法读取持久缓存时改从宿主读取 */
        }
      }
      if (!current()) return { rows: new Map(), pending: [] };
      const previous = snapshot;
      const answer = await settle(() =>
        host.library.getChanges(
          previous?.epoch ? { epoch: previous.epoch, since: previous.revision } : {},
        ),
      );
      if (!current()) return { rows: new Map(), pending: [] };
      const known = answer && answer.success !== false;
      const next: StatsSnapshot = {
        epoch: known ? answer.epoch : '',
        revision: known ? answer.revision : 0,
        rows: new Map(known && !answer.resync ? previous?.rows : []),
        status: previous?.status ?? null,
        reset: !previous || previous.reset || !known || !!answer.resync,
        changed: new Set(previous?.changed),
        removed: new Set(previous?.removed),
      };
      const alive = new Map(tracks.map((track) => [track.handle, track]));
      for (const [handle, row] of next.rows) {
        const track = alive.get(handle);
        if (!track || row.path !== trackPathOf(track)) {
          next.rows.delete(handle);
          next.removed.add(handle);
        }
      }
      if (known) {
        for (const handle of [...(answer.changed ?? []), ...(answer.removed ?? [])]) {
          next.rows.delete(handle);
          next.removed.add(handle);
        }
      }
      const pending = tracks.filter((track) => !next.rows.has(track.handle));
      for (const track of pending) next.changed.add(track.handle);
      snapshot = next;
      return { rows: next.rows, pending };
    },
    async save(read: HomeStatsRead, current: () => boolean): Promise<void> {
      const next = snapshot;
      if (!next || read.rows !== next.rows || !next.epoch || !current() || !connected()) return;
      try {
        const status = next.status ?? readLibraryStatsStatus(await request('status'));
        if (!status || !current()) return;
        const rows = [...next.changed].flatMap((handle) => next.rows.get(handle) ?? []);
        let result: unknown;
        if (
          !next.reset &&
          status.ready &&
          rows.length <= LIBRARY_STATS_PAGE &&
          next.removed.size <= LIBRARY_STATS_PAGE
        ) {
          if (next.revision === status.revision && rows.length === 0 && next.removed.size === 0)
            return;
          result = await request('apply', {
            generation: status.generation,
            epoch: next.epoch,
            revision: next.revision,
            rows,
            removed: [...next.removed],
          });
        } else {
          const begun = readLibraryStatsStatus(
            await request('begin', { generation: status.generation }),
          );
          if (!begun) return;
          next.status = begun;
          next.reset = true;
          if (!current()) return;
          const all = [...next.rows.values()];
          for (let at = 0; at < all.length; at += LIBRARY_STATS_PAGE) {
            if (!current()) return;
            await request('put', {
              generation: begun.generation,
              rows: all.slice(at, at + LIBRARY_STATS_PAGE),
            });
          }
          if (!current()) return;
          result = await request('commit', {
            generation: begun.generation,
            epoch: next.epoch,
            revision: next.revision,
          });
        }
        const saved = readLibraryStatsStatus(result);
        if (saved && snapshot === next && current()) {
          next.status = saved;
          next.reset = false;
          next.changed.clear();
          next.removed.clear();
        }
      } catch {
        // 保存失败时（如其他窗口已写入或后端已重启）丢弃快照，下一轮重新读取已提交的缓存
        if (snapshot === next) snapshot = undefined;
      }
    },
  };
}
