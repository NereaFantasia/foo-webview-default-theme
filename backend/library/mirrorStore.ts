import { statSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  LIBRARY_MIRROR_SCHEMA,
  MIRROR_ORDER_LIMIT,
  MIRROR_PAGE_LIMIT,
  type MirrorApplyReply,
  type MirrorApplyRequest,
  type MirrorOrder,
  type MirrorOrderRequest,
  type MirrorPage,
  type MirrorPageRequest,
  type MirrorRow,
  type MirrorStatus,
  type MirrorTrack,
} from '../../src/server/libraryMirrorProtocol.ts';
import { albumsOf, artistsOf } from './mirrorGroups.ts';
import { openRanks } from './mirrorRanks.ts';
import {
  RANK_COLLATOR,
  RANK_COLUMN,
  RANK_COMPONENTS,
  SORT_ORDER,
  rankTexts,
} from './mirrorSort.ts';

const RANK_COLUMNS = RANK_COMPONENTS.map((comp) => RANK_COLUMN[comp]);
const DATA_COLUMNS = [
  'album_key',
  'aa1',
  'path',
  'abs_path',
  'subsong',
  'title',
  'artist',
  'artists',
  'album',
  'album_id',
  'album_artist',
  'album_artists',
  'genre',
  'date',
  'codec',
  'track',
  'disc',
  'duration',
  'dur_s',
  'file_size',
  'bitrate',
  'sample_rate',
  'channels',
  'rating',
];
const WRITE_COLUMNS = ['handle', 'seq', 'gen', ...DATA_COLUMNS, ...RANK_COLUMNS];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    seq INTEGER NOT NULL,
    gen INTEGER NOT NULL,
    album_key TEXT,
    aa1 TEXT NOT NULL,
    path TEXT NOT NULL,
    abs_path TEXT NOT NULL,
    subsong INTEGER NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    artists TEXT NOT NULL,
    album TEXT NOT NULL,
    album_id TEXT,
    album_artist TEXT NOT NULL,
    album_artists TEXT NOT NULL,
    genre TEXT NOT NULL,
    date TEXT NOT NULL,
    codec TEXT NOT NULL,
    track INTEGER NOT NULL,
    disc INTEGER NOT NULL,
    duration REAL NOT NULL,
    dur_s INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    bitrate INTEGER NOT NULL,
    sample_rate INTEGER NOT NULL,
    channels INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    ${RANK_COLUMNS.map((column) => `${column} REAL`).join(',\n    ')}
  );
  CREATE INDEX IF NOT EXISTS tracks_album ON tracks (album_key, seq);
  CREATE TABLE IF NOT EXISTS track_artists (name TEXT NOT NULL, track_id INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS track_artists_name ON track_artists (name);
  CREATE INDEX IF NOT EXISTS track_artists_track ON track_artists (track_id);
  CREATE TABLE IF NOT EXISTS ranks (
    comp TEXT NOT NULL, value TEXT NOT NULL, rank REAL NOT NULL, PRIMARY KEY (comp, value)
  ) WITHOUT ROWID;
`;

/** 专辑键同宿主的折叠规则：优先 `albumId`，否则（专辑名，第一个专辑艺人，没有则第一个艺人）；没有专辑名不归任何专辑 */
function albumArtistOf(track: MirrorTrack): string {
  return track.albumArtists[0] ?? track.artists[0] ?? '';
}

function trackParams(
  track: MirrorTrack,
  seq: number,
  gen: number,
  ranks: Partial<Record<string, number>>,
): Record<string, SQLInputValue> {
  const aa1 = albumArtistOf(track);
  const values: Record<string, SQLInputValue> = {
    handle: track.handle,
    seq,
    gen,
    album_key: track.album ? (track.albumId ?? `${track.album}\0${aa1}`) : null,
    aa1,
    path: track.path,
    abs_path: track.absolutePath,
    subsong: track.subsong,
    title: track.title,
    artist: track.artist,
    artists: JSON.stringify(track.artists),
    album: track.album,
    album_id: track.albumId ?? null,
    album_artist: track.albumArtist,
    album_artists: JSON.stringify(track.albumArtists),
    genre: track.genre,
    date: track.date,
    codec: track.codec,
    track: track.trackNumber,
    disc: track.discNumber,
    duration: track.duration,
    dur_s: Math.round(track.duration),
    file_size: track.fileSize,
    bitrate: track.bitrate,
    sample_rate: track.sampleRate,
    channels: track.channels,
    rating: track.rating,
  };
  for (const column of RANK_COLUMNS) values[column] = ranks[column] ?? null;
  return values;
}

function strings(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(typeof value === 'string' ? value : '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowOf(row: Record<string, unknown>): MirrorRow {
  const text = (key: string) => (typeof row[key] === 'string' ? row[key] : '');
  return {
    handle: text('handle'),
    index: Number(row.seq),
    path: text('path'),
    absolutePath: text('abs_path'),
    subsong: Number(row.subsong),
    title: text('title'),
    artist: text('artist'),
    artists: strings(row.artists),
    album: text('album'),
    ...(typeof row.album_id === 'string' ? { albumId: row.album_id } : {}),
    albumArtist: text('album_artist'),
    albumArtists: strings(row.album_artists),
    genre: text('genre'),
    date: text('date'),
    trackNumber: Number(row.track),
    discNumber: Number(row.disc),
    duration: Number(row.duration),
    fileSize: Number(row.file_size),
    bitrate: Number(row.bitrate),
    sampleRate: Number(row.sample_rate),
    channels: Number(row.channels),
    codec: text('codec'),
    rating: Number(row.rating),
  };
}

/**
 * 媒体库镜像（SQLite）：镜像与宿主版本一致的凭据是（纪元，修订号），增量写入将行与新修订号置于同一事务；
 * 整库重建分三步执行，行携带新代次标记陆续写入，收尾事务统一清理旧代、计算排序秩并更新纪元与修订号；
 * 重建未收尾（`ready` 为假）时不可读，页面回退走宿主；数据库打不开时改用内存库
 */
export function openMirrorStore(path: string) {
  let db: DatabaseSync;
  let persistent = true;
  try {
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout = 2000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  } catch {
    db = new DatabaseSync(':memory:');
    persistent = false;
  }
  db.exec(SCHEMA);
  const ranks = openRanks(db);
  const readMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
  const writeMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  const meta = (key: string, fallback: string): string => {
    const value = readMeta.get(key)?.value;
    return typeof value === 'string' ? value : fallback;
  };
  const setMeta = (key: string, value: string | number) => void writeMeta.run(key, String(value));
  // 秩是按比较器排出来存下的：区域、ICU 或 CLDR 版本变了，旧秩与新插入值的次序就不一致，只能丢掉重建
  const collation = `${RANK_COLLATOR.resolvedOptions().locale}|icu ${String(process.versions.icu)}|cldr ${String(process.versions.cldr)}`;
  if (meta('schema', '') !== String(LIBRARY_MIRROR_SCHEMA) || meta('collation', '') !== collation) {
    db.exec('DELETE FROM tracks; DELETE FROM track_artists; DELETE FROM ranks; DELETE FROM meta');
    setMeta('schema', LIBRARY_MIRROR_SCHEMA);
    setMeta('collation', collation);
  }

  const upsert = db.prepare(
    `INSERT INTO tracks (${WRITE_COLUMNS.join(', ')})
     VALUES (${WRITE_COLUMNS.map((column) => `:${column}`).join(', ')})
     ON CONFLICT (handle) DO UPDATE SET
       ${WRITE_COLUMNS.filter((column) => column !== 'handle' && column !== 'seq')
         .map((column) => `${column} = excluded.${column}`)
         .join(',\n       ')},
       seq = CASE WHEN :keep THEN tracks.seq ELSE excluded.seq END
     RETURNING id`,
  );
  const dropArtists = db.prepare('DELETE FROM track_artists WHERE track_id = ?');
  const addArtist = db.prepare('INSERT INTO track_artists (name, track_id) VALUES (?, ?)');
  const dropByHandle = db.prepare(
    'DELETE FROM track_artists WHERE track_id IN (SELECT id FROM tracks WHERE handle = ?)',
  );
  const deleteByHandle = db.prepare('DELETE FROM tracks WHERE handle = ?');
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM tracks');
  const selectRows = db.prepare(
    'SELECT * FROM tracks WHERE handle IN (SELECT value FROM json_each(?))',
  );
  /** 这个连接上已经确认建好的排序索引；丢索引时清空 */
  const indexed = new Set<string>();
  const pages = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  const ready = () => meta('ready', '0') === '1';
  const count = () => Number(countAll.get()?.n ?? 0);

  /** 数据库文件加预写日志占的磁盘字节数 */
  function fileBytes(): number {
    if (!persistent) return 0;
    return [path, `${path}-wal`].reduce((sum, file) => {
      try {
        return sum + statSync(file).size;
      } catch {
        return sum;
      }
    }, 0);
  }

  /** 整库重写之后预写日志有几十 MiB，不截断它就一直占着盘 */
  function shrinkLog(): void {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // 有读取占着时截不动，下次整库重建再截
    }
  }

  function transaction<T>(work: () => T): T {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      // 秩的缓存可能已经含有回滚掉的值
      ranks.reset();
      throw error;
    }
  }

  function write(
    track: MirrorTrack,
    seq: number,
    gen: number,
    keep: boolean,
    rank: Partial<Record<string, number>>,
  ) {
    const params = { ...trackParams(track, seq, gen, rank), keep: keep ? 1 : 0 };
    const id = Number(upsert.get(params)?.id);
    return id;
  }

  function dropIndexes(): void {
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ix_%'",
    );
    for (const row of names.all()) db.exec(`DROP INDEX IF EXISTS ${String(row.name)}`);
    indexed.clear();
  }

  function ensureIndex(sort: MirrorPageRequest['sort']): void {
    if (indexed.has(sort)) return;
    indexed.add(sort);
    db.exec(
      `CREATE INDEX IF NOT EXISTS ix_${sort} ON tracks (${[...SORT_ORDER[sort], 'seq'].join(', ')})`,
    );
  }

  function generation(): number {
    return Number(meta('gen', '0'));
  }

  /** keyset 翻页：`columns` 是要读的列，排序列自动补上（游标要用）；`rows` 最多 `maxLimit` 行 */
  function scan(request: MirrorPageRequest, columns: string, maxLimit: number) {
    if (!ready()) throw new Error('镜像还没有建好');
    const limit = Math.min(maxLimit, Math.max(1, request.limit));
    const order = [...SORT_ORDER[request.sort], 'seq'];
    const cursor = request.after === null ? null : readCursor(request.after, order.length);
    ensureIndex(request.sort);
    const key = `${columns}:${request.sort}:${request.descending}:${cursor !== null}`;
    let statement = pages.get(key);
    if (!statement) {
      const direction = request.descending ? 'DESC' : 'ASC';
      const compare = request.descending ? '<' : '>';
      const where = cursor
        ? `WHERE (${order.join(', ')}) ${compare} (${order.map(() => '?').join(', ')})`
        : '';
      const select = columns === '*' ? '*' : `${columns}, ${order.join(', ')}`;
      statement = db.prepare(
        `SELECT ${select} FROM tracks ${where} ORDER BY ${order.map((c) => `${c} ${direction}`).join(', ')} LIMIT ?`,
      );
      pages.set(key, statement);
    }
    const found = statement.all(...(cursor ?? []), limit + 1);
    const rows = found.slice(0, limit);
    const last = rows.at(-1);
    const next =
      found.length > limit && last ? JSON.stringify(order.map((column) => last[column])) : null;
    return { rows, next };
  }

  function building(gen: number): void {
    if (ready() || gen !== generation()) throw new Error('重建的代次已过期');
  }

  return {
    status(): MirrorStatus {
      return {
        schema: LIBRARY_MIRROR_SCHEMA,
        epoch: meta('epoch', ''),
        revision: Number(meta('revision', '0')),
        count: count(),
        ready: ready(),
        bytes: fileBytes(),
      };
    },

    /** 增量：纪元或修订号对不上时不写，答 `stale: true`，由页面重新对账 */
    apply(request: MirrorApplyRequest): MirrorApplyReply {
      if (
        !ready() ||
        meta('epoch', '') !== request.epoch ||
        Number(meta('revision', '0')) !== request.since
      )
        return { stale: true };
      return transaction(() => {
        for (const handle of request.remove) {
          dropByHandle.run(handle);
          deleteByHandle.run(handle);
        }
        const texts = request.upsert.map((track) => rankTexts(track));
        const failed = RANK_COMPONENTS.filter(
          (comp) =>
            !ranks.add(
              comp,
              texts.map((text) => text[comp]),
            ),
        );
        let seq = Number(meta('seq', '1'));
        const gen = generation();
        request.upsert.forEach((track, i) => {
          const rank: Partial<Record<string, number>> = {};
          for (const comp of RANK_COMPONENTS) {
            const value = ranks.rank(comp, texts[i]?.[comp] ?? '');
            if (value !== undefined) rank[RANK_COLUMN[comp]] = value;
          }
          const id = write(track, seq++, gen, true, rank);
          dropArtists.run(id);
          for (const name of new Set(track.artists)) addArtist.run(name, id);
        });
        if (failed.length > 0) ranks.assignAll(failed);
        setMeta('seq', seq);
        setMeta('revision', request.revision);
        return { stale: false, count: count() };
      });
    },

    /** 开始整库重建：收尾前镜像不可读，返回新一代的代次 */
    rebuildBegin(): number {
      dropIndexes();
      const gen = generation() + 1;
      setMeta('ready', 0);
      setMeta('gen', gen);
      return gen;
    },

    /** 重建中写一批行，库序从 `indexFrom` 起 */
    rebuildPut(gen: number, tracks: readonly MirrorTrack[], indexFrom: number): number {
      building(gen);
      return transaction(() => {
        tracks.forEach((track, i) => write(track, indexFrom + i, gen, false, {}));
        return count();
      });
    },

    /** 重建收尾：清掉旧代的行，排秩，设上纪元与修订号，之后才可读 */
    rebuildCommit(gen: number, epoch: string, revision: number): number {
      building(gen);
      const total = transaction(() => {
        db.prepare('DELETE FROM tracks WHERE gen <> ?').run(gen);
        db.exec('DELETE FROM track_artists');
        db.exec(
          `INSERT INTO track_artists (name, track_id)
           SELECT DISTINCT j.value, t.id FROM tracks t, json_each(t.artists) j`,
        );
        ranks.assignAll();
        const top = Number(db.prepare('SELECT MAX(seq) AS top FROM tracks').get()?.top ?? 0);
        setMeta('seq', top + 1);
        setMeta('epoch', epoch);
        setMeta('revision', revision);
        setMeta('ready', 1);
        return count();
      });
      shrinkLog();
      return total;
    },

    page(request: MirrorPageRequest): MirrorPage {
      const { rows, next } = scan(request, '*', MIRROR_PAGE_LIMIT);
      return { rows: rows.map(rowOf), next, total: count() };
    },

    /** 同 `page`，但只取句柄（`paths` 为真时再取路径与 subsong），一页可以大得多 */
    order(request: MirrorOrderRequest): MirrorOrder {
      const columns = request.paths ? 'handle, path, subsong' : 'handle';
      const { rows, next } = scan(request, columns, MIRROR_ORDER_LIMIT);
      return {
        handles: rows.map((row) => String(row.handle)),
        paths: request.paths ? rows.map((row) => String(row.path)) : [],
        subsongs: request.paths ? rows.map((row) => Number(row.subsong)) : [],
        next,
        total: count(),
      };
    },

    rows(handles: readonly string[]): MirrorRow[] {
      if (!ready()) throw new Error('镜像还没有建好');
      const found = new Map<string, MirrorRow>();
      for (const row of selectRows.all(JSON.stringify(handles))) {
        const value = rowOf(row);
        found.set(value.handle, value);
      }
      return handles.flatMap((handle) => found.get(handle) ?? []);
    },

    albums() {
      if (!ready()) throw new Error('镜像还没有建好');
      return albumsOf(db);
    },

    artists() {
      if (!ready()) throw new Error('镜像还没有建好');
      return artistsOf(db);
    },

    clear(): void {
      transaction(() => {
        db.exec('DELETE FROM tracks; DELETE FROM track_artists; DELETE FROM ranks');
        setMeta('ready', 0);
        setMeta('epoch', '');
        setMeta('revision', 0);
        setMeta('seq', 1);
        setMeta('gen', generation() + 1);
      });
      dropIndexes();
      ranks.reset();
      shrinkLog();
    },

    close(): void {
      db.close();
    },
  };
}

export type MirrorStore = ReturnType<typeof openMirrorStore>;

function readCursor(after: string, length: number): SQLInputValue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(after);
  } catch {
    throw new Error('游标无效');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== length ||
    !parsed.every((value) => typeof value === 'number' && Number.isFinite(value))
  )
    throw new Error('游标无效');
  return parsed;
}
