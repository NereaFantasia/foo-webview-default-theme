import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { trackPathOf } from '../host/libraryContract.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { libraryTracksAtom, type LibraryTracksService } from './libraryTracks.ts';

/** 逗号也可以属于单个标签值；只对显示串含分隔符的曲目补读真正的多值 */
export const GENRES_VALUES_PATTERN = '$if($meta_num(genre),$meta_sep(genre,$char(31)),)';
const BATCH_SIZE = 128;

export interface GenreValuesState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  /** 每首的流派标签值，按 handle；没有流派的是空数组。读失败或换代途中留着上一份 */
  readonly values: ReadonlyMap<string, readonly string[]>;
  /** `values` 对应的整库曲目代次，见 `LibraryTracksState.generation`；还没读成过是 0 */
  readonly generation: number;
}
const INITIAL: GenreValuesState = { status: 'idle', values: new Map(), generation: 0 };
const stateAtom = atom<GenreValuesState>(INITIAL);
export const genreValuesAtom: Atom<GenreValuesState> = atom((get) => get(stateAtom));

export interface GenreValuesFace {
  titleformat: Pick<typeof fb.titleformat, 'evalBatch'>;
}
export interface GenreValuesService {
  /** 要用流派值：登记整库曲目并按当前代次读；同一代读过就不再读 */
  want(): void;
  retry(): Promise<void>;
  dispose(): void;
}

/**
 * 整库曲目的流派标签值，流派目录与歌曲、文件夹的分类共用：显示串按 `, ` 拼接多值，单个值里也可能有逗号，
 * 含分隔符的曲目向宿主补读真正的多值。跟随整库代次重读，库加载期间保留旧的一份；释放与换代都使未完成的补读作废
 */
export function startGenreValues(
  store: Store,
  tracksService: Pick<LibraryTracksService, 'want' | 'retry'>,
  host: GenreValuesFace = fb,
): GenreValuesService {
  store.set(stateAtom, INITIAL);
  let wanted = false;
  let releaseTracks: (() => void) | undefined;
  let disposed = false;
  let serial = 0;
  let loaded = -1;
  const update = (change: Partial<GenreValuesState>) =>
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
    const next = new Map<string, readonly string[]>();
    const ambiguous: LibraryTrack[] = [];
    for (const track of library.byHandle.values()) {
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
    update({ status: 'ready', values: next, generation: library.generation });
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
  return {
    want() {
      if (disposed) return;
      wanted = true;
      // 几处都会调 want；整库曲目只登记一次，到 dispose 才释放
      releaseTracks ??= tracksService.want();
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
      releaseTracks?.();
      releaseTracks = undefined;
      offTracks();
    },
  };
}

export const genreValuesKey = serviceKey<GenreValuesService>('genreValues');
