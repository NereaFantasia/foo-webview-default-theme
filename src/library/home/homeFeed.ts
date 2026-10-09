import { fb } from 'foo-webview-sdk/bridge';
import { atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { hasPlaycountComponent } from '../../host/playcountComponent.ts';
import { waitForHost } from '../../host/waitForHost.ts';
import { albumsAtom } from '../albums.ts';
import { LIBRARY_COALESCE_MS, onLibraryChanged, trackPathOf } from '../../host/libraryContract.ts';
import { libraryTracksAtom, type LibraryTracksService } from '../libraryTracks.ts';
import {
  EMPTY_HOME_STATISTICS,
  homeStatistics,
  type HomeStatistics,
  type HomePlaycountRow,
} from './homeModel.ts';

export interface HomeFeedState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';
  readonly available: boolean | null;
  readonly statistics: HomeStatistics;
  readonly dirty: boolean;
  readonly unreadCount: number;
  readonly failure: 'components' | 'library' | 'albums' | 'statistics' | null;
}

const INITIAL: HomeFeedState = {
  status: 'idle',
  available: null,
  statistics: EMPTY_HOME_STATISTICS,
  dirty: false,
  unreadCount: 0,
  failure: null,
};
export const HOME_STATS_BATCH = 500;
const MAX_RECOVERY_CALLS = 32;
export type HomeFeedHost = Pick<typeof fb, 'config' | 'playcount' | 'on' | 'ready' | 'isAvailable'>;

/** 已显示的统计只标记待刷新；用户显式刷新才换序，正在操作的条目不随播放事件移动。 */
export function startHomeFeed(
  store: ReturnType<typeof createStore>,
  tracks: Pick<LibraryTracksService, 'want' | 'retry'>,
  host: HomeFeedHost = fb,
) {
  const state = atom<HomeFeedState>(INITIAL);
  let disposed = false;
  let generation = 0;
  let probeGeneration = 0;
  let wanted = false;
  let releaseTracks: (() => void) | undefined;
  let connected = false;
  let computing = false;
  let published = false;
  let probing = false;
  let reported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  const offs: (() => void)[] = [];
  const patch = (change: Partial<HomeFeedState>) =>
    store.set(state, { ...store.get(state), ...change });

  function report(method: string, reason: unknown, detail: object = {}) {
    if (reported) return;
    reported = true;
    const field = (key: string): unknown =>
      typeof reason === 'object' && reason !== null ? Reflect.get(reason, key) : undefined;
    console.warn('播放统计读取失败', {
      method,
      code: field('code'),
      error: reason instanceof Error ? reason.message : (field('error') ?? String(reason)),
      ...detail,
    });
  }

  async function read<T extends { success: boolean }>(
    method: string,
    call: () => Promise<T>,
    current: () => boolean,
    detail: object = {},
  ) {
    const began = performance.now();
    let rejection: unknown;
    const answer = await settle(async () => {
      try {
        return await call();
      } catch (reason) {
        rejection = reason;
        throw reason;
      }
    });
    if (current() && (!answer || answer.success === false))
      report(method, answer ?? rejection, {
        ...detail,
        elapsedMs: Math.round(performance.now() - began),
      });
    return answer;
  }

  function invalidate() {
    if (disposed || !wanted) return;
    generation += 1;
    computing = false;
    clearTimeout(timer);
    patch({ dirty: true });
    if (!published)
      timer = setTimeout(() => {
        timer = undefined;
        void compute();
      }, LIBRARY_COALESCE_MS);
    else if (!probing) patch({ status: 'ready' });
  }

  async function compute() {
    const source = store.get(libraryTracksAtom);
    const catalog = store.get(albumsAtom);
    if (
      disposed ||
      !wanted ||
      !connected ||
      probing ||
      timer !== undefined ||
      store.get(state).available !== true ||
      computing ||
      published
    )
      return;
    if (source.status === 'failed') {
      report('library.getAll', '媒体库曲目读取失败');
      return patch({ status: 'failed', failure: 'library' });
    }
    if (catalog.status === 'failed') {
      report('library.getAlbums', '专辑清单读取失败');
      return patch({ status: 'failed', failure: 'albums' });
    }
    if (source.status !== 'ready' || catalog.status !== 'ready') return;
    const mine = ++generation;
    computing = true;
    patch({ status: 'loading' });
    const current = () => !disposed && mine === generation;
    const rows = [...source.byHandle.values()];
    const statistics = new Map<string, HomePlaycountRow>();
    let recoveryCalls = MAX_RECOVERY_CALLS;
    async function readBatch(paths: string[], offset: number): Promise<boolean> {
      if (!current()) return false;
      const answer = await read(
        'playcount.getBatch',
        () => host.playcount.getBatch(paths),
        current,
        {
          offset,
          count: paths.length,
        },
      );
      if (!current()) return false;
      if (!answer) return false;
      if (answer.success === false) {
        if (answer.code !== 'PERMISSION_DENIED') return false;
        // 权限拒绝发生在整批校验阶段。拆批隔离坏路径，限制额外调用，避免整库被拒时逐首重试。
        if (paths.length > 1 && recoveryCalls >= 2) {
          recoveryCalls -= 2;
          const middle = Math.floor(paths.length / 2);
          return (
            (await readBatch(paths.slice(0, middle), offset)) &&
            (await readBatch(paths.slice(middle), offset + middle))
          );
        }
        return true;
      }
      const requested = new Set(paths);
      for (const row of answer.results)
        if (row.success && requested.has(row.path)) statistics.set(row.path, row);
      const missing = paths.findIndex((path) => !statistics.has(path));
      if (missing >= 0)
        report(
          'playcount.getBatch',
          {
            error: answer.results.find((row) => !row.success)?.error ?? '统计应答缺少请求的曲目',
          },
          { offset, count: paths.length, failedIndex: missing },
        );
      return true;
    }
    for (let offset = 0; offset < rows.length; offset += HOME_STATS_BATCH) {
      const paths = rows.slice(offset, offset + HOME_STATS_BATCH).map(trackPathOf);
      if (!(await readBatch(paths, offset))) break;
    }
    if (!current()) return;
    computing = false;
    const unreadCount = rows.filter((track) => !statistics.has(trackPathOf(track))).length;
    if (rows.length > 0 && unreadCount === rows.length)
      return patch({ status: 'failed', failure: 'statistics', unreadCount });
    published = true;
    patch({
      status: 'ready',
      dirty: false,
      unreadCount,
      failure: null,
      statistics: homeStatistics(catalog.albums, rows, statistics),
    });
  }

  async function refresh() {
    if (disposed) return;
    wanted = true;
    generation += 1;
    const mine = ++probeGeneration;
    clearTimeout(timer);
    timer = undefined;
    computing = false;
    published = false;
    probing = true;
    reported = false;
    waiter?.cancel();
    const waiting = waitForHost(host);
    waiter = waiting;
    patch({ status: 'loading', dirty: false, failure: null });
    const arrived = await waiting.done;
    waiting.cancel();
    if (disposed || mine !== probeGeneration) return;
    if (!arrived) {
      probing = false;
      return patch({ status: 'unavailable' });
    }
    if (!connected) {
      connected = true;
      offs.push(onLibraryChanged(host, invalidate));
      offs.push(host.on('playback:trackChanged', invalidate));
      offs.push(host.on('metadb:changed', invalidate));
    }
    const installed = await read(
      'config.getComponents',
      () => host.config.getComponents(),
      () => !disposed && mine === probeGeneration,
    );
    if (disposed || mine !== probeGeneration) return;
    probing = false;
    if (!installed || installed.success === false)
      return patch({ status: 'failed', failure: 'components' });
    const available = hasPlaycountComponent(installed.components);
    patch({ available, status: available ? 'loading' : 'ready', unreadCount: 0 });
    if (!available) return;
    // 探测可能重跑（见 `probeGeneration`）；整库曲目只登记一次，到 dispose 才释放。
    releaseTracks ??= tracks.want();
    if (store.get(libraryTracksAtom).status === 'failed') await tracks.retry();
    if (disposed || mine !== probeGeneration) return;
    await compute();
  }

  const offTracks = store.sub(libraryTracksAtom, () => {
    if (!wanted) return;
    if (published || computing) invalidate();
    else void compute();
  });
  const offAlbums = store.sub(albumsAtom, () => {
    if (!wanted) return;
    if (published || computing) invalidate();
    else void compute();
  });
  return {
    state,
    activate() {
      if (!wanted) void refresh();
    },
    refresh,
    dispose() {
      disposed = true;
      generation += 1;
      probeGeneration += 1;
      clearTimeout(timer);
      waiter?.cancel();
      releaseTracks?.();
      releaseTracks = undefined;
      offTracks();
      offAlbums();
      offs.forEach((off) => off());
    },
  };
}

export type HomeFeedService = ReturnType<typeof startHomeFeed>;
