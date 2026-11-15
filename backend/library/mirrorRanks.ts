import type { DatabaseSync } from 'node:sqlite';
import {
  RANK_COLLATOR,
  RANK_COLUMN,
  RANK_COMPONENTS,
  rankTexts,
  type RankComponent,
  type RankSource,
} from './mirrorSort.ts';

/** 首次排出的秩之间的间隔，之后新值取相邻两个秩的中点 */
const STEP = 2 ** 20;
/** 相邻两个秩的间隔小于它就放不下新值，要整体重排 */
const MIN_GAP = 1e-3;

interface Group {
  readonly value: string;
  readonly rank: number;
}

/** 一个分量已有的秩：`groups` 按秩升序，每组取第一个值代表；`byValue` 查任一已见过的值 */
interface Book {
  groups: Group[];
  byValue: Map<string, number>;
}

const SCAN =
  'SELECT id, title, artist, album_artist, album, date, genre, codec, abs_path FROM tracks';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sourceOf(row: Record<string, unknown>): RankSource {
  return {
    title: text(row.title),
    artist: text(row.artist),
    albumArtist: text(row.album_artist),
    album: text(row.album),
    date: text(row.date),
    genre: text(row.genre),
    codec: text(row.codec),
    absolutePath: text(row.abs_path),
  };
}

function lowerBound(groups: readonly Group[], value: string): number {
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (RANK_COLLATOR.compare(groups[middle]?.value ?? '', value) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** 比较器认为相等的相邻值归成一组，返回按比较器升序的各组 */
function runsOf(values: readonly string[]): string[][] {
  const sorted = [...values].sort((a, b) => RANK_COLLATOR.compare(a, b));
  const runs: string[][] = [];
  for (const value of sorted) {
    const last = runs.at(-1);
    if (last && RANK_COLLATOR.compare(last[0] ?? '', value) === 0) last.push(value);
    else runs.push([value]);
  }
  return runs;
}

/**
 * 文本分量的秩，存在 `ranks` 表里并缓存在内存。新值只取相邻秩的中点，不动别的行；放不下时要调用方走
 * `assignAll` 整体重排。`ranks` 表里不再被用到的值不清理，整库重建时一并重来
 */
export function openRanks(db: DatabaseSync) {
  const books = new Map<RankComponent, Book>();
  const select = db.prepare('SELECT value, rank FROM ranks WHERE comp = ? ORDER BY rank');
  const upsert = db.prepare('INSERT OR REPLACE INTO ranks (comp, value, rank) VALUES (?, ?, ?)');
  const wipe = db.prepare('DELETE FROM ranks WHERE comp = ?');

  function bookOf(comp: RankComponent): Book {
    const cached = books.get(comp);
    if (cached) return cached;
    const book: Book = { groups: [], byValue: new Map() };
    for (const row of select.all(comp)) {
      const value = text(row.value);
      const rank = Number(row.rank);
      book.byValue.set(value, rank);
      if (book.groups.at(-1)?.rank !== rank) book.groups.push({ value, rank });
    }
    books.set(comp, book);
    return book;
  }

  return {
    rank(comp: RankComponent, value: string): number | undefined {
      return bookOf(comp).byValue.get(value);
    },

    /** 登记一批值的秩；全部放得下时写入并答 true，有一处放不下就什么都不写并答 false */
    add(comp: RankComponent, values: Iterable<string>): boolean {
      const book = bookOf(comp);
      const fresh = [...new Set(values)].filter((value) => !book.byValue.has(value));
      if (fresh.length === 0) return true;
      const shared: [string[], number][] = [];
      const gaps = new Map<number, string[][]>();
      for (const run of runsOf(fresh)) {
        const at = lowerBound(book.groups, run[0] ?? '');
        const hit = book.groups[at];
        if (hit && RANK_COLLATOR.compare(hit.value, run[0] ?? '') === 0)
          shared.push([run, hit.rank]);
        else gaps.set(at, [...(gaps.get(at) ?? []), run]);
      }
      const placed: [string[], number][] = [...shared];
      for (const [at, list] of gaps) {
        const low = book.groups[at - 1]?.rank;
        const high = book.groups[at]?.rank;
        const gap =
          low !== undefined && high !== undefined ? (high - low) / (list.length + 1) : STEP;
        if (gap < MIN_GAP) return false;
        list.forEach((run, i) => {
          const rank =
            low !== undefined
              ? low + gap * (i + 1)
              : high !== undefined
                ? high - gap * (list.length - i)
                : gap * (i + 1);
          placed.push([run, rank]);
        });
      }
      for (const [run, rank] of placed) {
        for (const value of run) {
          upsert.run(comp, value, rank);
          book.byValue.set(value, rank);
        }
      }
      const added = placed.filter(([run]) => !shared.some(([other]) => other === run));
      book.groups = [
        ...book.groups,
        ...added.map(([run, rank]) => ({ value: run[0] ?? '', rank })),
      ].sort((a, b) => a.rank - b.rank);
      return true;
    },

    /**
     * 对库里每一行重新排一遍所给分量：取去重后的值排序、等距赋秩、写回每行的秩列。整库重建收尾和
     * 间隙用尽时用，十万行约一秒，同步执行；调用方负责放在事务里
     */
    assignAll(comps: readonly RankComponent[] = RANK_COMPONENTS): void {
      const distinct = new Map(comps.map((comp) => [comp, new Set<string>()]));
      for (const row of db.prepare(SCAN).iterate()) {
        const texts = rankTexts(sourceOf(row));
        for (const comp of comps) distinct.get(comp)?.add(texts[comp]);
      }
      const ranked = new Map<RankComponent, Book>();
      for (const comp of comps) {
        const book: Book = { groups: [], byValue: new Map() };
        runsOf([...(distinct.get(comp) ?? [])]).forEach((run, i) => {
          const rank = (i + 1) * STEP;
          book.groups.push({ value: run[0] ?? '', rank });
          for (const value of run) book.byValue.set(value, rank);
        });
        wipe.run(comp);
        for (const [value, rank] of book.byValue) upsert.run(comp, value, rank);
        ranked.set(comp, book);
      }
      const updates: number[][] = [];
      for (const row of db.prepare(SCAN).iterate()) {
        const texts = rankTexts(sourceOf(row));
        updates.push([
          ...comps.map((comp) => ranked.get(comp)?.byValue.get(texts[comp]) ?? 0),
          Number(row.id),
        ]);
      }
      const set = comps.map((comp) => `${RANK_COLUMN[comp]} = ?`).join(', ');
      const update = db.prepare(`UPDATE tracks SET ${set} WHERE id = ?`);
      for (const values of updates) update.run(...values);
      for (const [comp, book] of ranked) books.set(comp, book);
    },

    /** 丢掉内存里的缓存；`ranks` 表被整体清空或换掉时用 */
    reset(): void {
      books.clear();
    },
  };
}

export type MirrorRanks = ReturnType<typeof openRanks>;
