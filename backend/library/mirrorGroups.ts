import type { DatabaseSync } from 'node:sqlite';
import type {
  MirrorAlbum,
  MirrorArtist,
  MirrorArtistAlbum,
} from '../../src/server/libraryMirrorProtocol.ts';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `genre` 是各值用 `", "` 连起来的串，拆不出名字里带逗号的单值；专辑的流派取第一个值 */
function firstValue(genre: string): string {
  return genre.split(', ')[0] ?? '';
}

/**
 * 专辑清单，规则同宿主的 `library.getAlbums`：按专辑键分组；曲数、时长、有碟号的不同碟数（没有则 1）；
 * 年份与流派取各曲中第一个非空的；首曲是库序最靠前的一首。专辑艺人没有 `label` 之类要补读的字段
 */
export function albumsOf(db: DatabaseSync): MirrorAlbum[] {
  const rows = db
    .prepare(
      `WITH g AS (
         SELECT album_key, COUNT(*) AS n, SUM(duration) AS dur, MIN(seq) AS first_seq,
                COUNT(DISTINCT CASE WHEN disc > 0 THEN disc END) AS discs
         FROM tracks WHERE album_key IS NOT NULL GROUP BY album_key)
       SELECT g.n, g.dur, g.discs, f.album, f.album_id, f.aa1, f.path, f.abs_path,
         (SELECT t.date FROM tracks t WHERE t.album_key = g.album_key AND t.date <> ''
            ORDER BY t.seq LIMIT 1) AS year,
         (SELECT t.genre FROM tracks t WHERE t.album_key = g.album_key AND t.genre <> ''
            ORDER BY t.seq LIMIT 1) AS genre
       FROM g JOIN tracks f ON f.album_key = g.album_key AND f.seq = g.first_seq
       ORDER BY g.first_seq`,
    )
    .all();
  return rows.map((row) => ({
    ...(typeof row.album_id === 'string' ? { albumId: row.album_id } : {}),
    name: text(row.album),
    artist: text(row.aa1),
    albumArtist: text(row.aa1),
    trackCount: Number(row.n),
    discCount: Number(row.discs) || 1,
    duration: Number(row.dur),
    year: text(row.year),
    genre: firstValue(text(row.genre)),
    firstTrackPath: text(row.path),
    firstTrackAbsolutePath: text(row.abs_path),
  }));
}

/**
 * 艺人清单，规则同 `library.getArtists`（带 `includeAlbums`）：每个艺人值一行；曲数、时长、不同专辑名的数量；
 * 参与的专辑按（专辑名，专辑艺人）列出，与专辑清单的行对得上
 */
export function artistsOf(db: DatabaseSync): MirrorArtist[] {
  const stats = db
    .prepare(
      `SELECT ta.name, COUNT(*) AS n, SUM(t.duration) AS dur, COUNT(DISTINCT NULLIF(t.album, '')) AS albums
       FROM track_artists ta JOIN tracks t ON t.id = ta.track_id GROUP BY ta.name ORDER BY ta.name`,
    )
    .all();
  const credits = new Map<string, MirrorArtistAlbum[]>();
  const refs = db
    .prepare(
      `SELECT DISTINCT ta.name, t.album, t.album_id, t.aa1
       FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
       WHERE t.album_key IS NOT NULL ORDER BY ta.name, t.album, t.aa1`,
    )
    .all();
  for (const row of refs) {
    const name = text(row.name);
    const list = credits.get(name) ?? [];
    list.push({
      ...(typeof row.album_id === 'string' ? { albumId: row.album_id } : {}),
      name: text(row.album),
      artist: text(row.aa1),
    });
    credits.set(name, list);
  }
  return stats.map((row) => ({
    name: text(row.name),
    albumCount: Number(row.albums),
    trackCount: Number(row.n),
    totalDuration: Number(row.dur),
    albums: credits.get(text(row.name)) ?? [],
  }));
}
