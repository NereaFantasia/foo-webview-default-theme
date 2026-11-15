import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FAVORITE_KINDS,
  FAVORITE_PAGE_LIMIT,
  FAVORITE_TOTAL_LIMIT,
  favoriteKeyOf,
  readFavoriteItem,
  type FavoriteEntry,
  type FavoriteKeys,
  type FavoriteKeyRow,
  type FavoriteKind,
  type FavoriteItems,
  type FavoriteList,
  type FavoriteStamp,
} from '../../src/server/musicFavorites.ts';
import type { MusicRef } from '../../src/server/musicObjects.ts';
import { isRecord } from './lxSource.ts';
import { MusicError } from './musicError.ts';
import { writeStateFile } from './stateFile.ts';

/** 文件最大字节数：读到更大的当作坏文件，不整个读进内存 */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

type Entries = Map<string, FavoriteEntry>;

/** 文件里的一条：格式不对返回 null；整个文件只要有一条读不出就按坏文件处理，不丢条目 */
function readEntry(value: unknown): FavoriteEntry | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  const kind = FAVORITE_KINDS.find((item) => item === value.kind);
  const addedAt = value.addedAt;
  if (!kind || typeof addedAt !== 'number' || !Number.isSafeInteger(addedAt) || addedAt < 0)
    return null;
  const item = readFavoriteItem(kind, value.item);
  return item ? { kind, item, addedAt } : null;
}

/** 读文件；没有文件是空，读不出来（坏文件、版本不认得、超大）是 null，由调用方决定怎么办 */
async function load(path: string): Promise<Entries | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    return isRecord(error) && error.code === 'ENOENT' ? new Map() : null;
  }
  if (text.length > MAX_FILE_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.entries)) return null;
    const entries: Entries = new Map();
    for (const raw of value.entries) {
      const entry = readEntry(raw);
      if (!entry) return null;
      entries.set(favoriteKeyOf(entry.kind, entry.item.ref), entry);
    }
    return entries.size <= FAVORITE_TOTAL_LIMIT ? entries : null;
  } catch {
    return null;
  }
}

/**
 * 本地收藏：状态目录里一个 JSON 文件，写进去才生效，同时到达的修改依次写。读不出来时所有操作都报设置不可用，
 * 也不动原文件，免得一次误写把还救得回来的收藏覆盖掉
 */
export async function startFavoritesStore(directory: string, now: () => number = Date.now) {
  const path = join(directory, 'music-favorites.v1.json');
  let current: Entries | null = await load(path);
  let writes: Promise<unknown> = Promise.resolve();

  /** 先在副本上改，写进文件后才换成新的；没改动就不写 */
  function commit<T>(
    change: (draft: Entries) => { readonly result: T; readonly changed: boolean },
  ) {
    const save = writes
      .catch(() => {})
      .then(async () => {
        if (!current) throw new MusicError('settings-unavailable');
        const draft: Entries = new Map(current);
        const { result, changed } = change(draft);
        if (changed) {
          await writeStateFile(path, { schema: 1, entries: [...draft.values()] });
          current = draft;
        }
        return result;
      });
    writes = save;
    return save;
  }

  /** 这一刻的内容；写入排队时，读到的是写完之前最后一个已生效的版本 */
  function entries(): Entries {
    if (!current) throw new MusicError('settings-unavailable');
    return current;
  }

  const stamp = (entry: FavoriteEntry): FavoriteStamp => ({
    ref: entry.item.ref,
    addedAt: entry.addedAt,
  });

  return {
    /** 各类收藏的身份与时间，收藏时间新到旧 */
    keys(): FavoriteKeys {
      const rows: { [K in FavoriteKind]: FavoriteKeyRow[] } = {
        track: [],
        album: [],
        artist: [],
        playlist: [],
      };
      for (const entry of newestFirst(entries()))
        rows[entry.kind].push([entry.item.ref.platform, entry.item.ref.id, entry.addedAt]);
      return rows;
    },
    /** 一类的一页条目，收藏时间新到旧；游标是偏移，翻页中途有增删时可能重复或漏一两条，页面按键去重 */
    list<K extends FavoriteKind>(kind: K, cursor: string | null): FavoriteList<K> {
      const offset = cursor === null ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset < 0 || String(offset) !== (cursor ?? '0'))
        throw new MusicError('invalid-request');
      const all = newestFirst(entries()).filter(
        (entry): entry is FavoriteEntry<K> => entry.kind === kind,
      );
      const items = all.slice(offset, offset + FAVORITE_PAGE_LIMIT);
      const next = offset + items.length;
      return {
        items,
        nextCursor: next < all.length ? String(next) : null,
        total: all.length,
      };
    },
    /** 加入：已有的只换快照、不动收藏时间；一批里重复的引用算一项。满了整批不收 */
    add<K extends FavoriteKind>(kind: K, items: readonly FavoriteItems[K][]) {
      return commit((draft) => {
        const stamps: FavoriteStamp[] = [];
        const at = now();
        for (const item of items) {
          const key = favoriteKeyOf(kind, item.ref);
          const had = draft.get(key);
          const entry: FavoriteEntry = { kind, item, addedAt: had?.addedAt ?? at };
          draft.set(key, entry);
          stamps.push(stamp(entry));
        }
        if (draft.size > FAVORITE_TOTAL_LIMIT) throw new MusicError('favorites-full');
        return { result: stamps, changed: items.length > 0 };
      });
    },
    /** 取消：返回实际取消了几项，不在收藏里的不算 */
    remove(kind: FavoriteKind, refs: readonly MusicRef[]) {
      return commit((draft) => {
        let removed = 0;
        for (const ref of refs) if (draft.delete(favoriteKeyOf(kind, ref))) removed += 1;
        return { result: removed, changed: removed > 0 };
      });
    },
    /** 刷新快照：只换库里本来就有的，不收新的，所以取消后才到的刷新不会把它收回来 */
    refresh<K extends FavoriteKind>(kind: K, items: readonly FavoriteItems[K][]) {
      return commit((draft) => {
        const stamps: FavoriteStamp[] = [];
        for (const item of items) {
          const key = favoriteKeyOf(kind, item.ref);
          const had = draft.get(key);
          if (!had) continue;
          draft.set(key, { kind, item, addedAt: had.addedAt });
          stamps.push({ ref: item.ref, addedAt: had.addedAt });
        }
        return { result: stamps, changed: stamps.length > 0 };
      });
    },
  };
}

/** 收藏时间新到旧；同一毫秒收的按收进来的先后倒着排 */
function newestFirst(entries: Entries): FavoriteEntry[] {
  return [...entries.values()]
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => b.entry.addedAt - a.entry.addedAt || b.order - a.order)
    .map(({ entry }) => entry);
}
