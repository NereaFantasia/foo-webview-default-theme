import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { Store } from '../../kit/store.ts';
import { albumsAtom } from '../albums.ts';
import { trackPathOf } from '../../host/libraryContract.ts';
import { libraryTracksAtom, type LibraryTracksService } from '../libraryTracks.ts';
import { buildGenres, type GenreEntry } from './genresModel.ts';

/** 逗号也可以属于单个标签值；只对显示串含分隔符的曲目补读真正的多值。 */
export const GENRES_VALUES_PATTERN = '$if($meta_num(genre),$meta_sep(genre,$char(31)),)';
const BATCH_SIZE = 128;

export interface GenresCatalogState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly entries: readonly GenreEntry[];
  readonly generation: number;
}
const stateAtom = atom<GenresCatalogState>({ status: 'idle', entries: [], generation: 0 });
export const genresCatalogAtom: Atom<GenresCatalogState> = atom((get) => get(stateAtom));

export interface GenresCatalogFace {
  titleformat: Pick<typeof fb.titleformat, 'evalBatch'>;
}
export interface GenresCatalogService {
  want(): void;
  retry(): Promise<void>;
  dispose(): void;
}

/** 跟随整库曲目的代次建索引，库加载期间保留旧清单；释放与库换代都使未完成的补读作废。 */
export function startGenresCatalog(
  store: Store,
  tracksService: Pick<LibraryTracksService, 'want' | 'retry'>,
  host: GenresCatalogFace = fb,
): GenresCatalogService {
  store.set(stateAtom, { status: 'idle', entries: [], generation: 0 });
  let wanted = false;
  let disposed = false;
  let serial = 0;
  let loaded = -1;
  let values: ReadonlyMap<string, readonly string[]> = new Map();
  const update = (change: Partial<GenresCatalogState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });

  async function load(force = false): Promise<void> {
    const library = store.get(libraryTracksAtom);
    if (!wanted || disposed || library.generation === 0 || library.status !== 'ready') return;
    if (!force && loaded === library.generation) return;
    loaded = library.generation;
    const mine = ++serial;
    const valid = () =>
      !disposed &&
      mine === serial &&
      store.get(libraryTracksAtom).status === 'ready' &&
      store.get(libraryTracksAtom).generation === library.generation;
    update({ status: 'loading' });
    const tracks = [...library.byHandle.values()];
    const next = new Map<string, readonly string[]>();
    const ambiguous: LibraryTrack[] = [];
    for (const track of tracks) {
      if (track.genre.includes(', ')) ambiguous.push(track);
      else next.set(track.handle, track.genre ? [track.genre] : []);
    }
    for (let start = 0; start < ambiguous.length; start += BATCH_SIZE) {
      if (!valid()) return;
      const batch = ambiguous.slice(start, start + BATCH_SIZE);
      const answer = await settle(() =>
        host.titleformat.evalBatch(GENRES_VALUES_PATTERN, batch.map(trackPathOf)),
      );
      if (!valid()) return;
      if (
        !answer ||
        answer.success === false ||
        answer.results.length !== batch.length ||
        answer.results.some((row) => row.success === false || row.infoAvailable === false)
      ) {
        update({ status: 'failed' });
        return;
      }
      for (const [index, track] of batch.entries()) {
        const row = answer.results[index];
        if (!row || !row.success) continue;
        next.set(track.handle, row.result ? row.result.split('\u001f').filter(Boolean) : []);
      }
    }
    if (!valid()) return;
    values = next;
    update({
      status: 'ready',
      entries: buildGenres(tracks, values, store.get(albumsAtom).albums),
      generation: library.generation,
    });
  }

  const offTracks = store.sub(libraryTracksAtom, () => {
    const library = store.get(libraryTracksAtom);
    if (!wanted) return;
    if (library.status === 'failed') {
      serial += 1;
      update({ status: 'failed' });
    } else if (library.generation === 0) update({ status: 'loading' });
    else void load();
  });
  const offAlbums = store.sub(albumsAtom, () => {
    const library = store.get(libraryTracksAtom);
    if (
      !wanted ||
      library.generation === 0 ||
      store.get(stateAtom).generation !== library.generation
    )
      return;
    update({
      entries: buildGenres([...library.byHandle.values()], values, store.get(albumsAtom).albums),
    });
  });
  return {
    want() {
      if (disposed) return;
      wanted = true;
      tracksService.want();
      const library = store.get(libraryTracksAtom);
      if (library.status === 'failed') update({ status: 'failed' });
      else if (library.generation === 0) update({ status: 'loading' });
      void load();
    },
    async retry() {
      if (disposed) return;
      await tracksService.retry();
      if (!disposed && store.get(stateAtom).status !== 'ready') await load(true);
    },
    dispose() {
      disposed = true;
      serial += 1;
      offTracks();
      offAlbums();
    },
  };
}
