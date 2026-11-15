import { DatabaseSync } from 'node:sqlite';

/** 总量上限的缺省值，字节 */
const STORE_BYTES = 50 * 1024 * 1024;
/** 「没有结果」的记录超过这个时间就当没记过：来源之后可能收录 */
export const MISSING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 在线歌词的持久化缓存（SQLite）
 *
 * 键是页面算好的查询摘要；值是页面序列化的歌词，`null` 表示来源明确没有这首。按最近使用淘汰到总量上限以内；
 * 数据库打不开时降级为内存库
 */
export function openLyricsStore(path: string, initialLimit = STORE_BYTES) {
  let limitBytes = initialLimit;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout = 2000');
  } catch {
    db = new DatabaseSync(':memory:');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS lyrics (
    key TEXT PRIMARY KEY, data TEXT, fetched INTEGER NOT NULL, used INTEGER NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS lyrics_used ON lyrics (used)');
  const select = db.prepare('SELECT data, fetched FROM lyrics WHERE key = ?');
  const touch = db.prepare('UPDATE lyrics SET used = ? WHERE key = ?');
  const remove = db.prepare('DELETE FROM lyrics WHERE key = ?');
  const upsert = db.prepare(
    `INSERT INTO lyrics (key, data, fetched, used) VALUES (?, ?, ?, ?) ON CONFLICT (key)
     DO UPDATE SET data = excluded.data, fetched = excluded.fetched, used = excluded.used`,
  );
  const size = 'LENGTH(CAST(key AS BLOB)) + IFNULL(LENGTH(CAST(data AS BLOB)), 0)';
  // 按使用时间倒序累计字节数，删掉超出上限的旧条目
  const trim = db.prepare(`DELETE FROM lyrics WHERE key IN (SELECT key FROM (
    SELECT key, SUM(${size}) OVER (ORDER BY used DESC, key) AS total FROM lyrics) WHERE total > ?)`);
  const total = db.prepare(
    `SELECT COUNT(*) AS count, IFNULL(SUM(${size}), 0) AS bytes FROM lyrics`,
  );

  return {
    /** 没记过或「没有结果」已过期答 undefined；读到就刷新使用时间 */
    get(key: string, now = Date.now()): { readonly data: string | null } | undefined {
      try {
        const row = select.get(key);
        if (!row) return undefined;
        const data = typeof row.data === 'string' ? row.data : null;
        if (data === null && now - Number(row.fetched) > MISSING_TTL_MS) {
          remove.run(key);
          return undefined;
        }
        touch.run(now, key);
        return { data };
      } catch {
        return undefined;
      }
    },
    put(key: string, data: string | null, now = Date.now()): void {
      try {
        db.exec('BEGIN');
        try {
          upsert.run(key, data, now, now);
          trim.run(limitBytes);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } catch {
        // 写不进去只是下次再联网
      }
    },
    stats(): { readonly count: number; readonly bytes: number } {
      try {
        const row = total.get();
        return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) };
      } catch {
        return { count: 0, bytes: 0 };
      }
    },
    clear(): void {
      try {
        db.exec('DELETE FROM lyrics');
      } catch {
        // 清不掉时保持原样，由下次统计如实反映
      }
    },
    setLimit(bytes: number): void {
      limitBytes = bytes;
      try {
        trim.run(limitBytes);
      } catch {
        // 下次写入时再淘汰
      }
    },
    close(): void {
      db.close();
    },
  };
}

export type LyricsStore = ReturnType<typeof openLyricsStore>;
