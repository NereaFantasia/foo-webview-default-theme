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

/** 媒体库镜像的请求处理：状态目录里一个 SQLite 文件，请求体已由调用方限长并解析成 JSON */
export function startLibraryMirror(state: string) {
  const store = openMirrorStore(
    join(state, `library-mirror.v${String(LIBRARY_MIRROR_SCHEMA)}.sqlite`),
  );
  return {
    request(action: LibraryMirrorAction, body: unknown): unknown {
      switch (action) {
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
