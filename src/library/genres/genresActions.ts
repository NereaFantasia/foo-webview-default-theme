import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../../host/hostCall.ts';
import type { Store } from '../../kit/store.ts';
import {
  playByQuery,
  sendQueryToNew,
  createQueryAutoplaylist,
  type QueryFill,
  type QueryFillFace,
  type QueryPlayStart,
} from '../libraryQueryFill.ts';
import { exclusive } from '../../playback/libraryView.ts';
import { genresCatalogAtom } from './genresCatalog.ts';
import { GENRES_SORT } from './genresGroups.ts';
import { genresQuery } from './genresModel.ts';

export type GenresActionNotice = 'failed' | 'busy' | 'unsupported' | 'gone' | null;
const noticeAtom = atom<GenresActionNotice>(null);
export const genresActionNoticeAtom: Atom<GenresActionNotice> = atom((get) => get(noticeAtom));
export interface GenresActionsDeps {
  record(keys: readonly string[], name: string): void;
  openSongs(keys: readonly string[]): void;
}
export interface GenresActionsFace extends QueryFillFace {
  library: QueryFillFace['library'] & Pick<typeof fb.library, 'query'>;
  isAvailable(): boolean;
  clipboard: Pick<typeof fb.clipboard, 'write'>;
}
export interface GenresActionsService {
  play(
    keys: readonly string[],
    name: string,
    start?: QueryPlayStart,
    fill?: QueryFill,
  ): Promise<boolean>;
  send(keys: readonly string[], name: string, autoplaylist: boolean): Promise<boolean>;
  openSongs(keys: readonly string[]): void;
  copy(text: string): Promise<boolean>;
  dismiss(): void;
  dispose(): void;
}

export function startGenresActions(
  store: Store,
  deps: GenresActionsDeps,
  host: GenresActionsFace = fb,
): GenresActionsService {
  store.set(noticeAtom, null);
  let disposed = false;
  let sending = false;
  const current = () => !disposed && host.isAvailable();
  function prepare(keys: readonly string[]): QueryFill | null {
    if (disposed || !host.isAvailable()) return null;
    const catalog = store.get(genresCatalogAtom);
    if (
      keys.length === 0 ||
      catalog.status !== 'ready' ||
      keys.some((key) => !catalog.entries.some((entry) => entry.key === key))
    ) {
      store.set(noticeAtom, 'gone');
      return null;
    }
    const query = genresQuery(keys);
    if (query === null) {
      store.set(noticeAtom, 'unsupported');
      return null;
    }
    store.set(noticeAtom, null);
    return { query, sort: GENRES_SORT.album, descending: false };
  }
  function finish(ok: boolean): boolean {
    if (!disposed && !ok) store.set(noticeAtom, 'failed');
    return ok;
  }
  return {
    async play(keys, name, start, shown) {
      const wanted = prepare(keys);
      if (!wanted) return false;
      const fill = shown ?? wanted;
      if (shown && shown.query !== wanted.query) return finish(false);
      const outcome = await exclusive(store, async () => {
        let beginning = start;
        if (beginning === undefined) {
          // 页头播放从查询结果的第一行开始；让查询填表后的核对走同一个入口。
          if (disposed) return false;
          const answer = await settle(() =>
            host.library.query(fill.query, fill.sort, 1, ['handle']),
          );
          if (disposed || !answer || answer.success === false) return false;
          const handle = answer.tracks[0]?.handle;
          if (!handle) return false;
          beginning = { row: 0, handle };
        }
        return playByQuery(host, fill, beginning, current);
      });
      if (disposed) return false;
      if (outcome === 'busy') {
        store.set(noticeAtom, 'busy');
        return false;
      }
      if (outcome) deps.record(keys, name);
      return finish(outcome);
    },
    async send(keys, name, autoplaylist) {
      if (sending) {
        if (!disposed) store.set(noticeAtom, 'busy');
        return false;
      }
      const fill = prepare(keys);
      if (!fill) return false;
      sending = true;
      try {
        return finish(
          await (autoplaylist
            ? createQueryAutoplaylist(host, name, fill, current)
            : sendQueryToNew(host, name, fill, current)),
        );
      } finally {
        sending = false;
      }
    },
    openSongs(keys) {
      if (prepare(keys)) deps.openSongs(keys);
    },
    async copy(text) {
      return !disposed && finish(await hostCommand(() => host.clipboard.write(text)));
    },
    dismiss() {
      if (!disposed) store.set(noticeAtom, null);
    },
    dispose() {
      disposed = true;
    },
  };
}
