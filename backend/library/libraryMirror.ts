import { join } from 'node:path';
import {
  LIBRARY_MIRROR_SCHEMA,
  MIRROR_ITEMS_PER_REQUEST,
  isMirrorSortColumn,
  readMirrorTrack,
  type LibraryMirrorAction,
  type MirrorApplyRequest,
  type MirrorPageRequest,
  type MirrorTrack,
} from '../../src/server/libraryMirrorProtocol.ts';
import { openMirrorStore } from './mirrorStore.ts';
import { LIBRARY_STATS_PAGE, readLibraryStatsRow } from '../../src/server/libraryStatsProtocol.ts';

function statistics(body: unknown) {
  const rows = items(body, 'rows');
  if (rows.length > LIBRARY_STATS_PAGE) throw new Error('播放统计行数超限');
  return rows.map((raw) => {
    const row = readLibraryStatsRow(raw);
    if (!row) throw new Error('播放统计行无效');
    return row;
  });
}

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined;
}

function count(body: unknown, key: string): number {
  const value = field(body, key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${key} 无效`);
  return value;
}

function text(body: unknown, key: string): string {
  const value = field(body, key);
  if (typeof value !== 'string') throw new Error(`${key} 无效`);
  return value;
}

function items(body: unknown, key: string): unknown[] {
  const value = field(body, key);
  if (!Array.isArray(value) || value.length > MIRROR_ITEMS_PER_REQUEST)
    throw new Error(`${key} 无效`);
  return value;
}

function tracks(body: unknown, key: string): MirrorTrack[] {
  return items(body, key).map((raw) => {
    const track = readMirrorTrack(raw);
    if (!track) throw new Error('曲目行无效');
    return track;
  });
}

function handles(body: unknown, key: string): string[] {
  return items(body, key).map((value) => {
    if (typeof value !== 'string') throw new Error(`${key} 无效`);
    return value;
  });
}

function readApply(body: unknown): MirrorApplyRequest {
  return {
    epoch: text(body, 'epoch'),
    since: count(body, 'since'),
    revision: count(body, 'revision'),
    upsert: tracks(body, 'upsert'),
    remove: handles(body, 'remove'),
  };
}

function readPage(body: unknown): MirrorPageRequest {
  const sort = field(body, 'sort');
  const after = field(body, 'after');
  const descending = field(body, 'descending');
  if (!isMirrorSortColumn(sort) || typeof descending !== 'boolean') throw new Error('排序无效');
  if (after !== null && typeof after !== 'string') throw new Error('游标无效');
  return { sort, descending, after, limit: count(body, 'limit') };
}

/** 处理媒体库镜像的请求。镜像是状态目录中的一个 SQLite 文件，请求体已由调用方限制长度并解析为 JSON */
export function startLibraryMirror(state: string) {
  const store = openMirrorStore(
    join(state, `library-mirror.v${String(LIBRARY_MIRROR_SCHEMA)}.sqlite`),
  );
  return {
    request(action: LibraryMirrorAction, body: unknown): unknown {
      switch (action) {
        case 'stats-status':
          return store.stats.status();
        case 'stats-page':
          return store.stats.page(count(body, 'generation'), text(body, 'after'));
        case 'stats-begin':
          return store.stats.begin(count(body, 'generation'));
        case 'stats-put':
          store.stats.put(count(body, 'generation'), statistics(body));
          return { success: true };
        case 'stats-commit':
          return store.stats.commit(
            count(body, 'generation'),
            text(body, 'epoch'),
            count(body, 'revision'),
          );
        case 'stats-apply':
          return store.stats.apply(
            count(body, 'generation'),
            text(body, 'epoch'),
            count(body, 'revision'),
            statistics(body),
            handles(body, 'removed'),
          );
        case 'status':
          return store.status();
        case 'apply':
          return store.apply(readApply(body));
        case 'rebuild-begin':
          return { generation: store.rebuildBegin() };
        case 'rebuild-put':
          return {
            count: store.rebuildPut(
              count(body, 'generation'),
              tracks(body, 'rows'),
              count(body, 'indexFrom'),
            ),
          };
        case 'rebuild-commit':
          return {
            count: store.rebuildCommit(
              count(body, 'generation'),
              text(body, 'epoch'),
              count(body, 'revision'),
            ),
          };
        case 'page':
          return store.page(readPage(body));
        case 'order':
          return store.order({ ...readPage(body), paths: field(body, 'paths') === true });
        case 'rows':
          return { rows: store.rows(handles(body, 'handles')) };
        case 'albums':
          return { albums: store.albums() };
        case 'artists':
          return { artists: store.artists() };
        case 'clear':
          store.clear();
          return { success: true };
      }
    },
    dispose(): void {
      store.close();
    },
  };
}
