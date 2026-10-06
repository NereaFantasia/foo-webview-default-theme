import { fb } from 'foo-webview-sdk/bridge';
import { atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
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
}

const INITIAL: HomeFeedState = {
  status: 'idle',
  available: null,
  statistics: EMPTY_HOME_STATISTICS,
  dirty: false,
};
export const HOME_STATS_BATCH = 500;
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
  let connected = false;
  let computing = false;
  let published = false;
  let probing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  const offs: (() => void)[] = [];
  const patch = (change: Partial<HomeFeedState>) =>
    store.set(state, { ...store.get(state), ...change });

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
    if (source.status === 'failed') return patch({ status: 'failed' });
    if (catalog.status === 'failed') return patch({ status: 'failed' });
    if (source.status !== 'ready' || catalog.status !== 'ready') return;
    const mine = ++generation;
    computing = true;
    patch({ status: 'loading' });
    const current = () => !disposed && mine === generation;
    const rows = [...source.byHandle.values()];
    const statistics = new Map<string, HomePlaycountRow>();
    for (let offset = 0; offset < rows.length; offset += HOME_STATS_BATCH) {
      const paths = rows.slice(offset, offset + HOME_STATS_BATCH).map(trackPathOf);
      const answer = await settle(() => host.playcount.getBatch(paths));
      if (!current()) return;
      if (
        !answer ||
        answer.success === false ||
        answer.results.length !== paths.length ||
        answer.results.some((row) => !row.success)
      ) {
        computing = false;
        patch({ status: 'failed' });
        return;
      }
      for (const row of answer.results) statistics.set(row.path, row);
    }
    if (!current()) return;
    computing = false;
    published = true;
    patch({
      status: 'ready',
      dirty: false,
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
    waiter?.cancel();
    const waiting = waitForHost(host);
    waiter = waiting;
    patch({ status: 'loading', dirty: false });
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
    const installed = await settle(() => host.config.getComponents());
    if (disposed || mine !== probeGeneration) return;
    probing = false;
    if (!installed || installed.success === false) return patch({ status: 'failed' });
    const available = installed.components.some((component) =>
      /(?:^|[\\/])foo_playcount(?:\.dll)?$/i.test(component.filename || component.fileName || ''),
    );
    patch({ available, status: available ? 'loading' : 'ready' });
    if (!available) return;
    tracks.want();
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
      offTracks();
      offAlbums();
      offs.forEach((off) => off());
    },
  };
}

export type HomeFeedService = ReturnType<typeof startHomeFeed>;
