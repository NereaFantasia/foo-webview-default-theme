import type { Atom } from 'jotai/vanilla';
import {
  browserStorage,
  defineLocalPref,
  storedRecord,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';

/**
 * 播放列表页筛选面板的呈现：嵌在页面里还是弹出浮层、嵌入时展开没展开。界面偏好，存 localStorage，各张列表共用
 * 筛选的内容（词、预设、条件）不在这里，那些只在内存与页面快照里
 */
export const PLAYLIST_FILTER_STORAGE_KEY = 'default-theme.playlist-filter.v1';

export interface PlaylistFilterSurfacePrefs {
  readonly docked: boolean;
  readonly expanded: boolean;
}

const PREF = defineLocalPref<PlaylistFilterSurfacePrefs>({
  key: PLAYLIST_FILTER_STORAGE_KEY,
  fallback: { docked: false, expanded: false },
  parse: (raw) => {
    const source = storedRecord(raw);
    return { docked: source['docked'] === true, expanded: source['expanded'] === true };
  },
  format: JSON.stringify,
});

export interface PlaylistFilterSurfaceService {
  readonly atom: Atom<PlaylistFilterSurfacePrefs>;
  setDocked(docked: boolean): void;
  setExpanded(expanded: boolean): void;
}

export function startPlaylistFilterSurface(
  store: Store,
  storage: PrefStorage | null = browserStorage(),
): PlaylistFilterSurfaceService {
  PREF.load(store, storage);
  return {
    atom: PREF.atom,
    setDocked(docked) {
      const current = store.get(PREF.atom);
      if (current.docked !== docked) PREF.set(store, { ...current, docked }, storage);
    },
    setExpanded(expanded) {
      const current = store.get(PREF.atom);
      if (current.expanded !== expanded) PREF.set(store, { ...current, expanded }, storage);
    },
  };
}
