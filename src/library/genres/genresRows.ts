import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { Store } from '../../kit/store.ts';
import type { QueryFill } from '../libraryQueryFill.ts';
import { libraryTracksAtom, TRACK_LIMIT } from '../libraryTracks.ts';
import { genresCatalogAtom } from './genresCatalog.ts';
import { arrangeGenreTracks, GENRES_SORT } from './genresGroups.ts';
import { genresQuery } from './genresModel.ts';
import type { GenreGrouping } from './genresPrefs.ts';
import { genreEntryOf, genreKeys } from './genresSubject.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { trackSortPattern } from '../../track/trackSort.ts';

export interface GenresRowsState {
  readonly key: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly tracks: readonly LibraryTrack[];
  readonly fill: QueryFill | null;
  readonly stamp: number;
  readonly generation: number;
  readonly invalid: boolean;
}
const EMPTY: GenresRowsState = {
  key: null,
  status: 'idle',
  tracks: [],
  fill: null,
  stamp: 0,
  generation: 0,
  invalid: false,
};
const stateAtom = atom<GenresRowsState>(EMPTY);
export const genresRowsAtom: Atom<GenresRowsState> = atom((get) => get(stateAtom));
export interface GenresRowsFace {
  library: Pick<typeof fb.library, 'query'>;
}
export interface GenresRowsService {
  select(
    key: string | null,
    group: GenreGrouping,
    query?: string,
    sort?: TableSort | null,
    delay?: number,
    groupDescending?: boolean,
  ): void;
  retry(): Promise<void>;
  dispose(): void;
}

/** 自选列排序时先按分组排，同组的行才连成一段；组内再按所选的列 */
const GROUP_PREFIX: Readonly<Record<GenreGrouping, string>> = {
  none: '',
  album: '%album% | %album artist% | %date% | ',
  albumDisc: '%album% | %album artist% | %date% | $num(%discnumber%,4) | ',
  albumArtist: '%album artist% | ',
  artist: '%artist% | ',
  directory: '$directory_path(%path%) | ',
};

/**
 * 换流派或分组时立即撤掉旧表；同一流派只改条件或排序时旧表留着，等新结果再换，输入途中表格不闪空。重取期间
 * `fill` 为空，动作不能使用未确认的新顺序。名称查不了的流派不套条件与排序，整份照旧显示
 */
export function startGenresRows(store: Store, host: GenresRowsFace = fb): GenresRowsService {
  store.set(stateAtom, EMPTY);
  let key: string | null = null;
  let group: GenreGrouping = 'album';
  let extraQuery = 'ALL';
  let sort: TableSort | null = null;
  let groupDescending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let serial = 0;
  let disposed = false;
  const update = (change: Partial<GenresRowsState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });
  async function load(): Promise<void> {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const mine = ++serial;
    if (disposed || key === null) return;
    const target = key;
    const catalog = store.get(genresCatalogAtom);
    if (catalog.status !== 'ready') {
      update({ status: catalog.status === 'failed' ? 'failed' : 'loading', fill: null });
      return;
    }
    const entry = genreEntryOf(catalog.entries, target);
    if (!entry) {
      update({ status: 'ready', tracks: [], fill: null });
      return;
    }
    const base = genresQuery(genreKeys(target));
    const library = store.get(libraryTracksAtom);
    if (base === null) {
      update({
        status: 'ready',
        tracks: entry.tracks,
        fill: null,
        stamp: library.stamp,
        generation: store.get(stateAtom).generation + 1,
      });
      return;
    }
    const query = extraQuery === 'ALL' ? base : `(${base}) AND (${extraQuery})`;
    // 宿主只给升序：降序与组序在客户端整理，表格与起播共用同一个次序。次序按此刻的设置固定下来，
    // 之后设置再变，手上这份结果的起播仍照它显示的次序
    const [mode, ordering, reverseGroups] = [group, sort, groupDescending];
    const rearranged = (ordering?.descending ?? false) || (mode !== 'none' && reverseGroups);
    const arrange = (rows: readonly LibraryTrack[]) =>
      arrangeGenreTracks(rows, mode, ordering, reverseGroups);
    const fill: QueryFill = {
      query,
      sort: ordering ? GROUP_PREFIX[mode] + trackSortPattern(ordering.column) : GENRES_SORT[mode],
      descending: false,
      ...(rearranged && {
        arrange: (handles: readonly string[]) => {
          const rows = handles.flatMap((handle) => library.byHandle.get(handle) ?? []);
          return rows.length === handles.length ? arrange(rows).map((row) => row.handle) : handles;
        },
      }),
    };
    update({ status: 'loading', invalid: false, fill: null });
    const answer = await settle(() =>
      host.library.query(fill.query, fill.sort, TRACK_LIMIT, ['handle']),
    );
    if (
      disposed ||
      mine !== serial ||
      store.get(libraryTracksAtom).generation !== library.generation
    )
      return;
    if (!answer || answer.success === false) {
      update({ status: 'failed', invalid: answer?.code === 'INVALID_PARAMS' });
      return;
    }
    const tracks: LibraryTrack[] = [];
    for (const row of answer.tracks) {
      const track = row.handle ? library.byHandle.get(row.handle) : undefined;
      if (!track) {
        update({ status: 'failed' });
        return;
      }
      tracks.push(track);
    }
    update({
      status: 'ready',
      tracks: rearranged ? arrange(tracks) : tracks,
      fill,
      stamp: library.stamp,
      generation: store.get(stateAtom).generation + 1,
    });
  }
  const off = store.sub(genresCatalogAtom, () => {
    serial += 1;
    void load();
  });
  return {
    select(next, grouping, query = 'ALL', ordering = null, delay = 0, descendingGroups = false) {
      const sameRows = !disposed && next === key && grouping === group;
      if (
        disposed ||
        (sameRows &&
          query === extraQuery &&
          ordering?.column === sort?.column &&
          ordering?.descending === sort?.descending &&
          descendingGroups === groupDescending)
      )
        return;
      key = next;
      group = grouping;
      extraQuery = query;
      sort = ordering;
      groupDescending = descendingGroups;
      serial += 1;
      if (timer !== undefined) clearTimeout(timer);
      if (sameRows) update({ status: 'loading', invalid: false, fill: null });
      else
        store.set(stateAtom, { ...EMPTY, key: next, status: next === null ? 'idle' : 'loading' });
      if (delay) timer = setTimeout(() => void load(), delay);
      else void load();
    },
    retry: load,
    dispose() {
      disposed = true;
      serial += 1;
      if (timer !== undefined) clearTimeout(timer);
      off();
    },
  };
}
