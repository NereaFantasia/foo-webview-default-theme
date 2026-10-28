import { DatabaseSync } from 'node:sqlite';
import {
  readMusicTrack,
  type MusicPlatform,
  type MusicTrack,
} from '../../src/server/musicObjects.ts';

/** 曲目元数据持久化存储容量上限（20 MB）；超出时按 LRU 顺序淘汰 */
const STORE_BYTES = 20 * 1024 * 1024;

export interface StoredTrack {
  /** 曲目详情；为 null 表示上游明确返回不存在 */
  readonly track: MusicTrack | null;
  /** 缓存获取时间戳（毫秒）；为 0 表示已失效并标记需要重新拉取 */
  readonly fetched: number;
}

function readRow(
  platform: MusicPlatform,
  id: string,
  data: unknown,
): MusicTrack | null | undefined {
  if (data === null) return null;
  if (typeof data !== 'string') return undefined;
  try {
    const track = readMusicTrack(JSON.parse(data));
    return track && track.ref.platform === platform && track.ref.id === id ? track : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 在线曲目元数据持久化存储（SQLite）
 *
 * 以平台与曲目 ID 复合主键缓存元数据；支持 LRU 淘汰与行级校验校验，
 * 数据库不可用或文件锁冲突时自动降级为内存临时库
 */
export function openTrackStore(path: string, limitBytes = STORE_BYTES) {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
    // 设置并发写锁等待超时，避免瞬时冲突直接报错
    db.exec('PRAGMA busy_timeout = 2000');
  } catch {
    db = new DatabaseSync(':memory:');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS tracks (
    key TEXT PRIMARY KEY, data TEXT, fetched INTEGER NOT NULL, used INTEGER NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS tracks_used ON tracks (used)');
  const select = db.prepare(
    'SELECT key, data, fetched FROM tracks WHERE key IN (SELECT value FROM json_each(?))',
  );
  const touch = db.prepare(
    'UPDATE tracks SET used = ? WHERE key IN (SELECT value FROM json_each(?))',
  );
  const upsert = db.prepare(
    `INSERT INTO tracks (key, data, fetched, used) VALUES (?, ?, ?, ?) ON CONFLICT (key)
     DO UPDATE SET data = excluded.data, fetched = excluded.fetched, used = excluded.used`,
  );
  // 按访问时间倒序计算累计字节大小，删除超出配额的历史记录
  const trim = db.prepare(`DELETE FROM tracks WHERE key IN (SELECT key FROM (
    SELECT key, SUM(LENGTH(key) + IFNULL(LENGTH(data), 0)) OVER (ORDER BY used DESC, key) AS total
    FROM tracks) WHERE total > ?)`);
  const keyOf = (platform: MusicPlatform, id: string) => `${platform}:${id}`;

  return {
    /** 批量读取指定 ID 的曲目缓存，并更新其访问时间戳 */
    get(platform: MusicPlatform, ids: readonly string[]): Map<string, StoredTrack> {
      const found = new Map<string, StoredTrack>();
      try {
        const keys = JSON.stringify(ids.map((id) => keyOf(platform, id)));
        for (const row of select.all(keys)) {
          const id = String(row.key).slice(platform.length + 1);
          const track = readRow(platform, id, row.data);
          if (track !== undefined) found.set(id, { track, fetched: Number(row.fetched) });
        }
        touch.run(Date.now(), keys);
      } catch {
        // 读取失败或库被锁定时降级为空结果，由调用方回退至上游拉取
      }
      return found;
    },
    /** 批量写入曲目元数据；包含上游不存在标记（null） */
    put(platform: MusicPlatform, entries: Iterable<readonly [string, MusicTrack | null]>): void {
      const now = Date.now();
      try {
        db.exec('BEGIN');
        try {
          for (const [id, track] of entries)
            upsert.run(keyOf(platform, id), track && JSON.stringify(track), now, now);
          trim.run(limitBytes);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } catch {
        // 写入失败时忽略，依赖后续上游查询重试
      }
    },
    /** 标记所有曲目缓存失效（如切换账号或音源变更）；保留现有数据用于展示并触发异步刷新 */
    expire(): void {
      try {
        db.exec('UPDATE tracks SET fetched = 0');
      } catch {
        // 忽略重置失败
      }
    },
    close(): void {
      db.close();
    },
  };
}

export type TrackStore = ReturnType<typeof openTrackStore>;
