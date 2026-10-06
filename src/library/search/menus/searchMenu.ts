import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { localeAtom } from '../../../i18n/locale.ts';
import { historyAtom } from '../../../nav/navHistory.ts';
import {
  EMPTY_CONTEXT_TREE,
  readContextTree,
  type ContextMenuFace,
} from '../../../host/contextMenu.ts';
import type { Store } from '../../../kit/store.ts';
import { albumsAtom } from '../../albums.ts';
import { MENU_HANDLES_LIMIT, UNION_ALBUM_LIMIT, UNION_TRACK_LIMIT } from '../../albumMenu.ts';
import {
  albumAutoplaylistQuery,
  fetchAlbumTracks,
  type AlbumTracksFace,
} from '../../albumTracks.ts';
import {
  albumKeyOf,
  trackPathOf,
  type Album,
  type TrackAlbumFields,
} from '../../../host/libraryContract.ts';
import { readSendTargets, type SendTarget } from '../../../track/trackListActions.ts';
import { searchHitKey, type SearchHit } from '../searchQuery.ts';
import type { SearchResultsService } from '../searchResults.ts';

interface SearchMenuDeps {
  findAlbum(track: TrackAlbumFields): Album | null;
  stamp(): number;
}
interface SearchMenuHost extends AlbumTracksFace, ContextMenuFace {
  playlist: Pick<typeof fb.playlist, 'getAll' | 'createAutoplaylist' | 'setActive'>;
}
interface SearchMenuState {
  readonly hit: SearchHit | null;
  readonly hits: readonly SearchHit[];
  readonly tracks: readonly LibraryTrack[];
  readonly paths: readonly string[];
  readonly stamp: number;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly limited: boolean;
  readonly targets: readonly SendTarget[];
  readonly tree: typeof EMPTY_CONTEXT_TREE;
}
const EMPTY: SearchMenuState = {
  hit: null,
  hits: [],
  tracks: [],
  paths: [],
  stamp: 0,
  loading: false,
  failed: false,
  limited: false,
  targets: [],
  tree: EMPTY_CONTEXT_TREE,
};

export function startSearchMenu(
  store: Store,
  results: SearchResultsService,
  deps: SearchMenuDeps,
  host: SearchMenuHost = fb,
) {
  const state = atom<SearchMenuState>(EMPTY);
  const notice = atom(false);
  let generation = 0;
  let disposed = false;
  let valid = () => false;
  const patch = (change: Partial<SearchMenuState>) =>
    store.set(state, { ...store.get(state), ...change });
  const close = () => {
    generation++;
    valid = () => false;
    store.set(state, EMPTY);
  };
  const invalidate = () => {
    if (store.get(state).hit && !valid()) close();
  };
  const off = [
    store.sub(results.state, invalidate),
    store.sub(albumsAtom, invalidate),
    store.sub(historyAtom, invalidate),
  ];

  async function retry() {
    const mine = generation;
    if (!valid()) return;
    const paths = store.get(state).paths;
    if (paths.length > MENU_HANDLES_LIMIT) {
      patch({ tree: { ...EMPTY_CONTEXT_TREE, loading: false } });
      return;
    }
    patch({ tree: EMPTY_CONTEXT_TREE });
    const tree = await readContextTree(
      host,
      { mode: 'handles', handles: [...paths] },
      store.get(localeAtom).base,
    );
    if (mine === generation && valid()) patch({ tree });
  }
  async function open(hit: SearchHit, selection: readonly SearchHit[] = [hit]) {
    close();
    const hits = [...new Map(selection.map((item) => [searchHitKey(item), item])).values()];
    const mine = generation;
    const source = store.get(results.state);
    const catalog = store.get(albumsAtom).albums;
    const entry = store.get(historyAtom).entry;
    const visibleAlbums = new Set(store.get(results.albums).map(albumKeyOf));
    const visibleTracks = new Set(source.tracks.map((track) => track.handle));
    const found =
      hits.length > 0 &&
      hits.every((item) =>
        item.kind === 'album'
          ? visibleAlbums.has(albumKeyOf(item.album))
          : visibleTracks.has(item.track.handle),
      );
    valid = () =>
      !disposed &&
      found &&
      mine === generation &&
      store.get(historyAtom).entry === entry &&
      store.get(results.state).text === source.text &&
      store.get(results.state).status === source.status &&
      store.get(results.state).tracks === source.tracks &&
      store.get(albumsAtom).enabled &&
      (hits.some((item) => item.kind === 'album')
        ? store.get(albumsAtom).albums === catalog
        : true);
    if (!valid()) return;
    const stamp = deps.stamp();
    const albumCount = hits.filter((item) => item.kind === 'album').length;
    const trackCount = hits.reduce(
      (count, item) => count + (item.kind === 'album' ? item.album.trackCount : 1),
      0,
    );
    const limited =
      hits.length > 1 && (albumCount > UNION_ALBUM_LIMIT || trackCount > UNION_TRACK_LIMIT);
    store.set(state, { ...EMPTY, hit, hits, stamp, limited, loading: !limited });
    if (limited) return;
    const targets = readSendTargets(host).then((items) => {
      if (valid() && mine === generation) patch({ targets: items });
    });
    const tracks = new Map<string, LibraryTrack>();
    const paths = new Set<string>();
    const loaded = new Map<string, readonly LibraryTrack[]>();
    let failed = false;
    for (const item of hits) {
      const album = item.kind === 'album' ? item.album : deps.findAlbum(item.track);
      if (album) {
        const key = albumKeyOf(album);
        let rows = loaded.get(key);
        if (!rows) {
          rows = (await settle(() => fetchAlbumTracks(host, album, { fresh: true }))) ?? undefined;
          if (!valid() || mine !== generation) return;
          if (rows) loaded.set(key, rows);
        }
        const picked =
          item.kind === 'album'
            ? rows
            : rows?.filter((track) => track.handle === item.track.handle);
        if (!picked?.length) {
          failed = true;
          break;
        }
        for (const track of picked) {
          const path = trackPathOf(track);
          tracks.set(path, track);
          paths.add(path);
        }
      } else if (item.kind === 'track' && item.track.path) {
        paths.add(trackPathOf({ path: item.track.path, subsong: item.track.subsong ?? 0 }));
      } else {
        failed = true;
        break;
      }
    }
    if (!valid() || mine !== generation) return;
    // 任一对象读取失败时整批不可执行，不能悄悄只发送已读到的部分。
    patch({
      tracks: failed ? [] : [...tracks.values()],
      paths: failed ? [] : [...paths],
      loading: false,
      failed: failed || !paths.size,
    });
    if (!failed && paths.size) await retry();
    await targets;
  }
  return {
    state,
    notice,
    open,
    close,
    retry,
    isCurrent: () => valid(),
    async createAutoplaylist() {
      const hits = store.get(state).hits;
      if (!valid() || !hits.length || hits.some((hit) => hit.kind !== 'album')) return;
      const albums = hits.flatMap((hit) => (hit.kind === 'album' ? [hit.album] : []));
      const query = albumAutoplaylistQuery(albums);
      if (!query) return;
      store.set(notice, false);
      const created = await settle(() =>
        host.playlist.createAutoplaylist(albums.map((album) => album.name).join(', '), query),
      );
      if (disposed) return;
      if (!created || created.success === false) {
        store.set(notice, true);
        return;
      }
      const activated = await settle(() => host.playlist.setActive(created.index));
      if (!disposed && (!activated || activated.success === false)) store.set(notice, true);
    },
    dispose() {
      disposed = true;
      close();
      for (const unsubscribe of off) unsubscribe();
    },
  };
}

export type SearchMenuService = ReturnType<typeof startSearchMenu>;
