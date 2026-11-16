import type { DatabaseSync } from 'node:sqlite';
import {
  LIBRARY_STATS_PAGE,
  readLibraryStatsRow,
  type LibraryStatsRow,
  type LibraryStatsStatus,
} from '../../src/server/libraryStatsProtocol.ts';

/** 打开播放统计缓存。统计与曲目镜像共用数据库，修订号单独保存。整库写入未完成时不可读 */
export function openLibraryStatsStore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS play_stats (
      handle TEXT PRIMARY KEY, data TEXT NOT NULL, gen INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS play_stats_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1), ready INTEGER NOT NULL,
      epoch TEXT NOT NULL, revision INTEGER NOT NULL, gen INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO play_stats_meta VALUES (1, 0, '', 0, 0);
  `);
  const get = db.prepare('SELECT * FROM play_stats_meta WHERE id = 1');
  const put = db.prepare('INSERT OR REPLACE INTO play_stats VALUES (?, ?, ?)');
  const drop = db.prepare('DELETE FROM play_stats WHERE handle = ?');
  const select = db.prepare(
    'SELECT handle, data FROM play_stats WHERE handle > ? ORDER BY handle LIMIT ?',
  );
  function status(): LibraryStatsStatus {
    const row = get.get();
    return {
      ready: row?.ready === 1,
      epoch: String(row?.epoch ?? ''),
      revision: Number(row?.revision ?? 0),
      generation: Number(row?.gen ?? 0),
    };
  }
  function check(generation: number, ready: boolean): void {
    const current = status();
    if (current.generation !== generation || current.ready !== ready)
      throw new Error('播放统计缓存的代次已过期');
  }
  function transaction(work: () => void): void {
    db.exec('BEGIN');
    try {
      work();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    status,
    page(generation: number, after: string) {
      check(generation, true);
      const found = select.all(after, LIBRARY_STATS_PAGE + 1);
      const rows = found.slice(0, LIBRARY_STATS_PAGE).map((row) => {
        const parsed = readLibraryStatsRow(JSON.parse(String(row.data)));
        if (!parsed) throw new Error('播放统计缓存的曲目行无效');
        return parsed;
      });
      return {
        rows,
        next: found.length > LIBRARY_STATS_PAGE ? (rows.at(-1)?.handle ?? null) : null,
      };
    },
    begin(generation: number) {
      if (status().generation !== generation) throw new Error('播放统计缓存的代次已过期');
      db.exec('UPDATE play_stats_meta SET ready = 0, gen = gen + 1 WHERE id = 1');
      return status();
    },
    put(generation: number, rows: readonly LibraryStatsRow[]) {
      check(generation, false);
      transaction(() => {
        for (const row of rows) put.run(row.handle, JSON.stringify(row), generation);
      });
    },
    commit(generation: number, epoch: string, revision: number) {
      check(generation, false);
      transaction(() => {
        db.prepare('DELETE FROM play_stats WHERE gen <> ?').run(generation);
        db.prepare(
          'UPDATE play_stats_meta SET ready = 1, epoch = ?, revision = ? WHERE id = 1',
        ).run(epoch, revision);
      });
      return status();
    },
    apply(
      generation: number,
      epoch: string,
      revision: number,
      rows: readonly LibraryStatsRow[],
      removed: readonly string[],
    ) {
      check(generation, true);
      const current = status();
      if (epoch !== current.epoch || revision < current.revision)
        throw new Error('播放统计修订号已过期');
      transaction(() => {
        for (const handle of removed) drop.run(handle);
        for (const row of rows) put.run(row.handle, JSON.stringify(row), generation + 1);
        db.prepare(
          'UPDATE play_stats_meta SET epoch = ?, revision = ?, gen = gen + 1 WHERE id = 1',
        ).run(epoch, revision);
      });
      return status();
    },
    clear() {
      db.exec(
        "DELETE FROM play_stats; UPDATE play_stats_meta SET ready = 0, epoch = '', revision = 0, gen = gen + 1 WHERE id = 1",
      );
    },
  };
}
