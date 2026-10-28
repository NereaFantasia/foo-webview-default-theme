import { EMPTY_TRACK_FILTER, trackQueryOf, type TrackFilter } from '../../../track/trackFilter.ts';
import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { normalizeHostPath } from '../../../host/hostPath.ts';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import { isVideoPath } from '../../../track/mediaKind.ts';
import { QUERY_DEBOUNCE_MS } from '../../../track/queryInput.ts';
import { startTrackFilter, type TrackFilterService } from '../../../track/trackFilterState.ts';

import { foldersPrefsAtom } from '../foldersPrefs.ts';
import { foldersPreviewAtom } from './foldersPreview.ts';

export interface FoldersResultsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly invalid: boolean;
  readonly tracks: readonly LibraryTrack[];
  readonly total: number;
  readonly filtered: boolean;
  readonly answered: string | null;
}
const EMPTY: FoldersResultsState = {
  status: 'idle',
  invalid: false,
  tracks: [],
  total: 0,
  filtered: false,
  answered: null,
};
const stateAtom = atom<FoldersResultsState>(EMPTY);
const filterAtom = atom<TrackFilter>(EMPTY_TRACK_FILTER);
export const foldersResultsAtom: Atom<FoldersResultsState> = atom((get) => get(stateAtom));
export const foldersConditionsAtom: Atom<TrackFilter> = atom((get) => get(filterAtom));
/**
 * 媒体类型：只看视频时，作用域里只留视频文件，表头统计、分面、表格与播放都跟着它走；
 * 按扩展名认，目录里的曲目已全部在手，不必再问宿主；和筛选条件一样只在内存与页面快照里留
 */
export type FoldersMedia = 'all' | 'video';
const mediaAtom = atom<FoldersMedia>('all');
export const foldersMediaAtom: Atom<FoldersMedia> = atom((get) => get(mediaAtom));
export const foldersScopeTracksAtom = atom((get) => {
  const preview = get(foldersPreviewAtom);
  const video = get(mediaAtom) === 'video';
  let inRange = preview.tracks;
  if (!get(foldersPrefsAtom).recursive) {
    const paths = new Set(
      preview.nodes.map((node) => normalizeHostPath(node.absolutePath).replace(/\\+$/, '')),
    );
    inRange = preview.tracks.filter((track) => {
      const path = normalizeHostPath(track.absolutePath);
      return paths.has(path.slice(0, path.lastIndexOf('\\')));
    });
  }
  return video ? inRange.filter((track) => isVideoPath(track.path)) : inRange;
});
export interface FoldersResultsService extends TrackFilterService {
  flush(): void;
  setMedia(media: FoldersMedia): void;
}

export function startFoldersResults(
  store: Store,
  host: { library: Pick<typeof fb.library, 'search'> } = fb,
): FoldersResultsService {
  store.set(stateAtom, EMPTY);
  store.set(filterAtom, EMPTY_TRACK_FILTER);
  store.set(mediaAtom, 'all');
  let disposed = false;
  let serial = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = store.get(foldersPreviewAtom);
  let preferences = store.get(foldersPrefsAtom);
  function cancel() {
    serial += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  async function load(mine: number) {
    timer = undefined;
    const tracks = store.get(foldersScopeTracksAtom);
    const query = trackQueryOf(store.get(filterAtom), store.get(foldersPrefsAtom).scope);
    const current = () => !disposed && mine === serial;
    if (!query.filtered || tracks.length === 0) {
      if (current())
        store.set(stateAtom, {
          status: 'ready',
          invalid: false,
          tracks,
          total: tracks.length,
          filtered: query.filtered,
          answered: query.query,
        });
      return;
    }
    const expected = new Set(tracks.map((track) => track.handle));
    const found = new Set<string>();
    let offset = 0;
    while (current()) {
      const answer = await settle(() =>
        host.library.search(query.query, 1000, { offset, fields: ['handle'] }),
      );
      if (!current()) return;
      if (!answer || answer.success === false) {
        store.set(stateAtom, {
          ...store.get(stateAtom),
          status: 'failed',
          invalid: answer?.code === 'INVALID_PARAMS',
        });
        return;
      }
      for (const track of answer.tracks)
        if (track.handle && expected.has(track.handle)) found.add(track.handle);
      if (!answer.hasMore || found.size === expected.size) break;
      if (!answer.tracks.length) {
        store.set(stateAtom, { ...store.get(stateAtom), status: 'failed' });
        return;
      }
      offset += answer.tracks.length;
    }
    if (current())
      store.set(stateAtom, {
        status: 'ready',
        invalid: false,
        tracks: tracks.filter((track) => found.has(track.handle)),
        total: tracks.length,
        filtered: true,
        answered: query.query,
      });
  }
  function schedule(delay = 0, clear = false) {
    cancel();
    if (disposed) return;
    if (store.get(foldersPreviewAtom).status !== 'ready') {
      store.set(stateAtom, EMPTY);
      return;
    }
    store.set(stateAtom, {
      ...(clear ? EMPTY : store.get(stateAtom)),
      status: 'loading',
      invalid: false,
    });
    const mine = serial;
    timer = setTimeout(() => void load(mine), delay);
  }
  const offPreview = store.sub(foldersPreviewAtom, () => {
    const next = store.get(foldersPreviewAtom);
    const changed = next !== previous;
    previous = next;
    if (changed) schedule(0, true);
  });
  const offPrefs = store.sub(foldersPrefsAtom, () => {
    const next = store.get(foldersPrefsAtom);
    const changed = next.scope !== preferences.scope || next.recursive !== preferences.recursive;
    preferences = next;
    if (changed) schedule(0, true);
  });
  const offMedia = store.sub(mediaAtom, () => schedule(0, true));
  const filter = startTrackFilter(store, filterAtom, (typing) =>
    schedule(typing ? QUERY_DEBOUNCE_MS : 0),
  );
  schedule();
  return {
    ...filter,
    flush: () => schedule(),
    setMedia: (media) => store.set(mediaAtom, media),
    dispose() {
      disposed = true;
      filter.dispose();
      cancel();
      offPreview();
      offPrefs();
      offMedia();
    },
  };
}
