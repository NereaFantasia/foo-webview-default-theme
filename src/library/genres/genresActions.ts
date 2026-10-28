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
import { genresRowsAtom } from './genresRows.ts';
import { genresSubject } from './genresSubject.ts';

export type GenresActionNotice = 'failed' | 'busy' | 'unsupported' | 'gone' | null;
const noticeAtom = atom<GenresActionNotice>(null);
export const genresActionNoticeAtom: Atom<GenresActionNotice> = atom((get) => get(noticeAtom));
export interface GenresActionsDeps {
  record(keys: readonly string[], name: string): void;
  openSongs(keys: readonly string[], fill?: QueryFill): void;
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
  send(
    keys: readonly string[],
    name: string,
    autoplaylist: boolean,
    fill?: QueryFill,
  ): Promise<boolean>;
  openSongs(keys: readonly string[], fill?: QueryFill): void;
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
  function prepare(keys: readonly string[], shown?: QueryFill): QueryFill | null {
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
    if (shown) {
      const rows = store.get(genresRowsAtom);
      if (rows.status !== 'ready' || rows.key !== genresSubject(keys) || rows.fill !== shown) {
        store.set(noticeAtom, 'gone');
        return null;
      }
      return shown;
    }
    return { query, sort: GENRES_SORT.album, descending: false };
  }
  function finish(ok: boolean): boolean {
    if (!disposed && !ok) store.set(noticeAtom, 'failed');
    return ok;
  }
  return {
    async play(keys, name, start, shown) {
      const fill = prepare(keys, shown);
      if (!fill) return false;
      // 显示中的结果已核对是当前那一份，表格第一行就是它的第一行；降序时宿主升序的第一首在末尾，不能再去查
      const first = shown && store.get(genresRowsAtom).tracks[0]?.handle;
      const outcome = await exclusive(store, async () => {
        let beginning = start ?? (first ? { row: 0, handle: first } : undefined);
        if (beginning === undefined) {
          // 页头播放从查询结果的第一行开始；让查询填表后的核对走同一个入口
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
    async send(keys, name, autoplaylist, shown) {
      if (sending) {
        if (!disposed) store.set(noticeAtom, 'busy');
        return false;
      }
      const fill = prepare(keys, shown);
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
    openSongs(keys, shown) {
      if (!prepare(keys, shown)) return;
      if (shown) deps.openSongs(keys, shown);
      else deps.openSongs(keys);
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
