import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import {
  EMPTY_UP_NEXT,
  UP_NEXT_FIELDS,
  UP_NEXT_PAGE_SIZE,
  upNextTrackOf,
  type UpNextRow,
  type UpNextSource,
  type UpNextView,
} from './upNextModel.ts';

/** 只留视口附近及最近访问的六页，滚完整张来源也不累积全部元数据。 */
export const UP_NEXT_CACHED_PAGES = 6;

export interface UpNextPagesOptions {
  /** 界面还没要过任何一段时，换来源只发布总数、不读：这一段平时不在视口里，用不着先读。 */
  readonly lazy?: boolean;
}

export function createUpNextPages(
  playlist: Pick<typeof fb.playlist, 'getTracks'>,
  publish: (view: UpNextView) => void,
  options: UpNextPagesOptions = {},
) {
  let source: UpNextSource | null = null;
  let published = EMPTY_UP_NEXT;
  let paused = false;
  let holding = false;
  let generation = 0;
  let disposed = false;
  let running: Promise<void> | null = null;
  let requested = false;
  let wanted: number[] = [];
  let firstWanted = 0;
  let lastWanted = 0;
  const cache = new Map<number, readonly UpNextRow[]>();
  const failed = new Set<number>();
  const asking = new Set<number>();

  const write = () => {
    if (disposed || paused) return;
    if (holding && source?.total) {
      const first = Math.floor(firstWanted / UP_NEXT_PAGE_SIZE);
      const last = Math.floor(lastWanted / UP_NEXT_PAGE_SIZE);
      for (let page = first; page <= last; page++)
        if (!cache.has(page) && !failed.has(page)) return;
    }
    holding = false;
    published = {
      ...EMPTY_UP_NEXT,
      list: source?.list ?? null,
      total: source?.total ?? 0,
      sourceCount: source?.count ?? 0,
      currentCount: source ? Math.min(source.total, source.count - source.after) : 0,
      version: generation,
      rows: [...cache].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows),
      failedPages: new Set(failed),
    };
    publish(published);
  };

  async function readPage(current: UpNextSource, page: number, mine: number) {
    const offset = page * UP_NEXT_PAGE_SIZE;
    const count = Math.min(UP_NEXT_PAGE_SIZE, current.total - offset);
    const first = (current.after + offset) % current.count;
    const tail = Math.min(count, current.count - first);
    const rows: UpNextRow[] = [];
    for (const [from, size] of [
      [first, tail],
      [0, count - tail],
    ]) {
      if (!size) continue;
      if (disposed || mine !== generation) return null;
      const answer = await settle(() =>
        playlist.getTracks(current.list.guid, from, size, undefined, [...UP_NEXT_FIELDS]),
      );
      if (answer?.success !== true || answer.tracks.length !== size) return null;
      for (const [i, track] of answer.tracks.entries()) {
        rows.push({
          key: `${current.list.guid}:${from + i}:${track.handle ?? ''}`,
          row: from + i,
          offset: offset + rows.length,
          track: upNextTrackOf(track),
        });
      }
    }
    return rows;
  }

  async function pump(mine: number): Promise<void> {
    while (source && !disposed && mine === generation) {
      const page = wanted.find((at) => !cache.has(at) && !failed.has(at) && !asking.has(at));
      if (page === undefined) return;
      asking.add(page);
      const rows = await readPage(source, page, mine);
      if (disposed || mine !== generation) return;
      asking.delete(page);
      if (rows) cache.set(page, rows);
      else failed.add(page);
      for (const oldest of cache.keys()) {
        if (cache.size <= UP_NEXT_CACHED_PAGES) break;
        if (!wanted.includes(oldest)) cache.delete(oldest);
      }
      // 错误也只跟着当前窗口保留；重新进入这一页时允许再次读取。
      for (const at of failed) if (!wanted.includes(at)) failed.delete(at);
      write();
    }
  }

  function readWindow(first: number, last: number, retry = false): Promise<void> {
    if (disposed || paused || !source || source.total === 0) return Promise.resolve();
    firstWanted = Math.max(0, Math.min(source.total - 1, first));
    lastWanted = Math.max(firstWanted, Math.min(source.total - 1, last));
    const endPage = Math.floor((source.total - 1) / UP_NEXT_PAGE_SIZE);
    const start = Math.min(endPage, Math.max(0, Math.floor(first / UP_NEXT_PAGE_SIZE)));
    const end = Math.min(endPage, Math.max(start, Math.floor(last / UP_NEXT_PAGE_SIZE)));
    wanted = Array.from(
      { length: Math.min(UP_NEXT_CACHED_PAGES, end - start + 1) },
      (_, i) => start + i,
    );
    // 先读视口，再预取两侧各两页；普通连续滚动越过页边时已有元数据。
    for (const page of [end + 1, start - 1, end + 2, start - 2]) {
      if (page >= 0 && page <= endPage && wanted.length < UP_NEXT_CACHED_PAGES) wanted.push(page);
    }
    for (const page of failed) if (!wanted.includes(page)) failed.delete(page);
    for (const page of wanted) {
      const rows = cache.get(page);
      if (rows) {
        cache.delete(page);
        cache.set(page, rows);
      }
      if (retry) failed.delete(page);
    }
    if (running) return running;
    const mine = generation;
    // 先装上在途标记，宿主的同步失败或空范围也不能留下已结束的 Promise。
    running = Promise.resolve()
      .then(() => Promise.all([pump(mine), pump(mine)]))
      .then(() => {})
      .finally(() => {
        if (mine === generation) {
          running = null;
          // 完成与 finally 之间仍可能收到新视口，不能把新请求挂在已结束的 Promise 上。
          if (!disposed && wanted.some((page) => !cache.has(page) && !failed.has(page)))
            void readWindow(firstWanted, lastWanted);
        }
      });
    return running;
  }

  function reset(next: UpNextSource | null) {
    generation++;
    source = next;
    cache.clear();
    failed.clear();
    asking.clear();
    wanted = [];
    running = null;
    paused = false;
  }

  return {
    reset(next: UpNextSource | null) {
      reset(next);
      holding = false;
      write();
    },
    suspend() {
      if (disposed) return;
      generation++;
      paused = true;
      holding = true;
      running = null;
      asking.clear();
      published = { ...published, refreshing: true, version: generation };
      publish(published);
    },
    async replace(next: UpNextSource) {
      if (disposed) return;
      const sameList = source?.list.guid === next.list.guid;
      const shift = sameList && source ? source.after - next.after : 0;
      const first = sameList ? Math.max(0, Math.min(next.total - 1, firstWanted + shift)) : 0;
      const last = Math.max(first, Math.min(next.total - 1, first + lastWanted - firstWanted));
      reset(next);
      if (options.lazy && !requested) {
        holding = false;
        write();
        return;
      }
      holding = true;
      firstWanted = first;
      lastWanted = last;
      // 总数和可见页一起发布；离屏预取不用阻塞当前画面。
      if (next.total === 0) write();
      else await readWindow(first, last);
    },
    readRange(first: number, last: number, retry = false) {
      requested = true;
      const shift =
        published.refreshing && source?.list.guid === published.list?.guid
          ? published.sourceCount - published.currentCount - (source?.after ?? 0)
          : 0;
      if (paused) {
        firstWanted = Math.max(0, first + shift);
        lastWanted = Math.max(firstWanted, last + shift);
        return Promise.resolve();
      }
      return readWindow(first + shift, last + shift, retry);
    },
    async readSelection(offsets: readonly number[], version: number): Promise<UpNextRow[] | null> {
      const current = source;
      if (disposed || paused || holding || !current || version !== generation) return null;
      const picked = [...new Set(offsets)].sort((a, b) => a - b);
      const result: UpNextRow[] = [];
      let page = -1;
      let rows: readonly UpNextRow[] = [];
      // 菜单确实需要整批曲目时才读取；不挤走滚动缓存，也不改变视口请求的优先级。
      for (const offset of picked) {
        if (!Number.isInteger(offset) || offset < 0 || offset >= current.total) return null;
        const next = Math.floor(offset / UP_NEXT_PAGE_SIZE);
        if (next !== page) {
          page = next;
          const answer = cache.get(page) ?? (await readPage(current, page, version));
          if (!answer || disposed || version !== generation) return null;
          rows = answer;
        }
        const row = rows[offset % UP_NEXT_PAGE_SIZE];
        if (!row) return null;
        result.push(row);
      }
      return disposed || version !== generation ? null : result;
    },
    dispose() {
      disposed = true;
      generation++;
      cache.clear();
      failed.clear();
    },
  };
}
