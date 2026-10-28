import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import { albumsAtom } from '../albums.ts';
import { genreValuesAtom, type GenreValuesService } from '../genreValues.ts';
import { libraryTracksAtom } from '../libraryTracks.ts';
import { buildGenres, type GenreEntry } from './genresModel.ts';

export interface GenresCatalogState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly entries: readonly GenreEntry[];
  readonly generation: number;
}
const stateAtom = atom<GenresCatalogState>({ status: 'idle', entries: [], generation: 0 });
export const genresCatalogAtom: Atom<GenresCatalogState> = atom((get) => get(stateAtom));

export interface GenresCatalogService {
  want(): void;
  retry(): Promise<void>;
  dispose(): void;
}

/**
 * 流派目录：整库曲目按流派标签值归类。标签值的读取归共用的流派值服务；读失败、整库重读与补读途中都保留
 * 旧目录，同一份标签值与专辑清单不重建
 */
export function startGenresCatalog(
  store: Store,
  values: Pick<GenreValuesService, 'want' | 'retry'>,
): GenresCatalogService {
  store.set(stateAtom, { status: 'idle', entries: [], generation: 0 });
  let wanted = false;
  let built: { readonly values: unknown; readonly albums: unknown } | null = null;
  const update = (change: Partial<GenresCatalogState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });

  const mark = (status: GenresCatalogState['status']) => {
    if (store.get(stateAtom).status !== status) update({ status });
  };

  function sync(): void {
    if (!wanted) return;
    const library = store.get(libraryTracksAtom);
    const read = store.get(genreValuesAtom);
    if (library.status === 'failed' || read.status === 'failed') mark('failed');
    else if (library.generation === 0 || read.status === 'loading') mark('loading');
    else if (
      library.status === 'ready' &&
      read.status === 'ready' &&
      read.generation === library.generation
    ) {
      const { albums } = store.get(albumsAtom);
      if (built?.values === read.values && built.albums === albums) mark('ready');
      else {
        built = { values: read.values, albums };
        update({
          status: 'ready',
          entries: buildGenres([...library.byHandle.values()], read.values, albums),
          generation: read.generation,
        });
      }
    }
    // 其余是整库重读途中：旧目录照旧，等新一代的标签值
  }

  const offs = [
    store.sub(libraryTracksAtom, sync),
    store.sub(genreValuesAtom, sync),
    store.sub(albumsAtom, sync),
  ];
  return {
    want() {
      if (!offs.length) return;
      wanted = true;
      values.want();
      sync();
    },
    async retry() {
      if (offs.length) await values.retry();
    },
    dispose() {
      wanted = false;
      for (const off of offs.splice(0)) off();
    },
  };
}
