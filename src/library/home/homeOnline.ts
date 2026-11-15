import { atom, type Atom } from 'jotai/vanilla';
import { localeAtom } from '../../i18n/locale.ts';
import { choiceCodec, defineLocalPref, ON_OFF } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import type { MusicClient } from '../../playback/musicClient.ts';
import type { MusicStatusService } from '../../playback/musicStatus.ts';
import {
  MUSIC_DISCOVER_AREAS,
  type MusicBanner,
  type MusicChart,
  type MusicDiscoverArea,
} from '../../server/musicDiscover.ts';
import type { MusicAlbum, MusicPlaylist, MusicRef, MusicTrack } from '../../server/musicObjects.ts';
import { homeHiddenSectionsAtom } from './homeSections.ts';

/** 新歌速递一行的曲目数：三列，每列四行 */
export const HOME_NEW_TRACK_COUNT = 12;
/** 新歌速递可选的地区；平台的「全部」是各区混排，这一行不给 */
export const HOME_TRACK_AREAS = [
  'zh',
  'ea',
  'jp',
  'kr',
] as const satisfies readonly MusicDiscoverArea[];
/** 最新发布可选的地区 */
export const HOME_ALBUM_AREAS = MUSIC_DISCOVER_AREAS;

/** 离开首页超过这个时长再回来时，各类内容重取一次。后端另有缓存，重取多半不会访问网络 */
const STALE_MS = 30 * 60_000;

export type HomeOnlineRead<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: T }
  | { readonly status: 'failed' };

const LOADING = { status: 'loading' } as const;

const areaCodec = choiceCodec<MusicDiscoverArea>(MUSIC_DISCOVER_AREAS);
/** 用户选过的地区；没选过为 null，按界面语言取 */
const areaPref = (key: string) =>
  defineLocalPref<MusicDiscoverArea | null>({
    key,
    fallback: null,
    parse: areaCodec.parse,
    format: (value) => value ?? '',
  });
const TRACK_AREA = areaPref('default-theme.home-track-area.v1');
const ALBUM_AREA = areaPref('default-theme.home-album-area.v1');
/** 首页顶上「下载网易云组件」那张卡点过不再显示 */
const SETUP_DISMISSED = defineLocalPref<boolean>({
  key: 'default-theme.home-ncm-setup.v1',
  fallback: false,
  ...ON_OFF,
});

/** 按界面语言选的缺省地区：中文看华语，日语看日本，韩语看韩国，其余看欧美 */
export function areaOfLocale(locale: string): MusicDiscoverArea {
  if (locale.startsWith('zh')) return 'zh';
  if (locale.startsWith('ja')) return 'jp';
  if (locale.startsWith('ko')) return 'kr';
  return 'ea';
}

export interface HomeOnlineService {
  /** 网易云在线音乐可用：后端的平台里有网易云。状态还没读到时为 false，在线的几行先不出 */
  readonly available: Atom<boolean>;
  /** 网易云组件没装：首页顶上出下载卡的前提之一 */
  readonly missing: Atom<boolean>;
  readonly banners: Atom<HomeOnlineRead<readonly MusicBanner[]>>;
  readonly charts: Atom<HomeOnlineRead<readonly MusicChart[]>>;
  readonly playlists: Atom<HomeOnlineRead<readonly MusicPlaylist[]>>;
  /** 正在显示的那一区的新歌：刚换地区时仍是原来那一区，新的一区取到后换过去 */
  readonly newTracks: Atom<HomeOnlineRead<readonly MusicTrack[]>>;
  /** 正在显示的那一区的新碟，换地区时同上 */
  readonly newAlbums: Atom<HomeOnlineRead<readonly MusicAlbum[]>>;
  /** 菜单里选中的地区 */
  readonly trackArea: Atom<MusicDiscoverArea>;
  readonly albumArea: Atom<MusicDiscoverArea>;
  readonly setupDismissed: Atom<boolean>;
  setTrackArea(area: MusicDiscoverArea): void;
  setAlbumArea(area: MusicDiscoverArea): void;
  dismissSetup(): void;
  /** 首页挂上时调：重读在线音乐状态；可用时取还没取到、或取到已超过 `STALE_MS` 的各类，设置里关掉的行不取 */
  activate(): void;
  dispose(): void;
}

export interface HomeOnlineDeps {
  readonly client: Pick<MusicClient, 'discover'>;
  readonly status: Pick<MusicStatusService, 'state' | 'refresh'>;
  readonly now?: () => number;
}

export function startHomeOnline(store: Store, deps: HomeOnlineDeps): HomeOnlineService {
  const now = deps.now ?? Date.now;
  const lifetime = new AbortController();
  let active = false;

  /** 一类内容的读取：取到过的再取失败时保留上一次的，取数途中不重复发 */
  function loader<T>(request: (signal: AbortSignal) => Promise<T>) {
    const state = atom<HomeOnlineRead<T>>(LOADING);
    let fetched = 0;
    let pending = false;
    return {
      state,
      async load() {
        const ready = store.get(state).status === 'ready';
        if (pending || (ready && now() - fetched < STALE_MS)) return;
        pending = true;
        try {
          const items = await request(lifetime.signal);
          if (lifetime.signal.aborted) return;
          fetched = now();
          store.set(state, { status: 'ready', items });
        } catch {
          if (!lifetime.signal.aborted && store.get(state).status !== 'ready')
            store.set(state, { status: 'failed' });
        } finally {
          pending = false;
        }
      },
    };
  }
  type Loader<T> = ReturnType<typeof loader<T>>;
  const perArea = <T>(make: (area: MusicDiscoverArea) => Loader<T>) => ({
    all: make('all'),
    zh: make('zh'),
    ea: make('ea'),
    jp: make('jp'),
    kr: make('kr'),
  });

  const { client } = deps;
  const banners = loader((signal) => client.discover({ kind: 'banners' }, { signal }));
  const charts = loader((signal) => client.discover({ kind: 'charts' }, { signal }));
  const playlists = loader((signal) => client.discover({ kind: 'playlists' }, { signal }));
  const tracks = perArea((area) =>
    loader((signal) => client.discover({ kind: 'new-tracks', area }, { signal })),
  );
  const albums = perArea((area) =>
    loader((signal) => client.discover({ kind: 'new-albums', area }, { signal })),
  );

  TRACK_AREA.load(store);
  ALBUM_AREA.load(store);
  SETUP_DISMISSED.load(store);
  const fallbackArea = atom((get) => areaOfLocale(get(localeAtom).active));
  const trackArea = atom((get) => {
    const chosen = get(TRACK_AREA.atom) ?? get(fallbackArea);
    return HOME_TRACK_AREAS.find((area) => area === chosen) ?? 'zh';
  });
  const albumArea = atom((get) => get(ALBUM_AREA.atom) ?? get(fallbackArea));
  const available = atom((get) => {
    const read = get(deps.status.state);
    return read.status === 'ready' && read.music.platforms.includes('wy');
  });
  const missing = atom((get) => {
    const read = get(deps.status.state);
    return read.status === 'ready' && read.music.ncm === 'missing';
  });

  /**
   * 换地区时先接着显示原来那一区，新的一区取到（或取失败）再换过去，免得整行先消失再出现
   * `chosen` 是菜单里选中的地区；返回正在显示的那一区的读取，与换地区的函数
   */
  function switcher<T>(
    loaders: Readonly<Record<MusicDiscoverArea, Loader<T>>>,
    chosen: Atom<MusicDiscoverArea>,
    save: (area: MusicDiscoverArea) => void,
  ) {
    const pinned = atom<MusicDiscoverArea | null>(null);
    return {
      shown: atom((get) => get(loaders[get(pinned) ?? get(chosen)].state)),
      async change(area: MusicDiscoverArea) {
        store.set(pinned, store.get(pinned) ?? store.get(chosen));
        save(area);
        if (active && store.get(available)) await loaders[area].load();
        if (store.get(chosen) === area) store.set(pinned, null);
      },
    };
  }
  const trackSwitch = switcher(tracks, trackArea, (area) => TRACK_AREA.set(store, area));
  const albumSwitch = switcher(albums, albumArea, (area) => ALBUM_AREA.set(store, area));

  /** 在设置里关掉的行不取 */
  function loadAll() {
    if (!active || !store.get(available)) return;
    const hidden = store.get(homeHiddenSectionsAtom);
    if (!hidden.includes('banners')) void banners.load();
    if (!hidden.includes('new-tracks')) void tracks[store.get(trackArea)].load();
    if (!hidden.includes('charts')) void charts.load();
    if (!hidden.includes('playlists')) void playlists.load();
    if (!hidden.includes('releases')) void albums[store.get(albumArea)].load();
  }
  // 状态晚到、组件刚装好时接着取
  const stop = store.sub(available, loadAll);

  return {
    available,
    missing,
    banners: banners.state,
    charts: charts.state,
    playlists: playlists.state,
    newTracks: trackSwitch.shown,
    newAlbums: albumSwitch.shown,
    trackArea,
    albumArea,
    setupDismissed: SETUP_DISMISSED.atom,
    setTrackArea: (area) => void trackSwitch.change(area),
    setAlbumArea: (area) => void albumSwitch.change(area),
    dismissSetup: () => SETUP_DISMISSED.set(store, true),
    activate() {
      active = true;
      deps.status.refresh();
      loadAll();
    },
    dispose() {
      lifetime.abort();
      stop();
    },
  };
}

const refKey = (ref: MusicRef) => `${ref.platform}:${ref.id}`;

/**
 * 榜单的次序：第一名已在前面的榜里当过第一的，排到第一屏之后，免得一屏几张卡的第一名都一样
 * `first` 是第一屏整张露出的卡数
 */
export function orderCharts(charts: readonly MusicChart[], first: number): MusicChart[] {
  const seen = new Set<string>();
  const fresh: MusicChart[] = [];
  const again: MusicChart[] = [];
  for (const chart of charts) {
    const lead = chart.entries[0];
    const key = lead ? refKey(lead.track.ref) : null;
    (key && seen.has(key) ? again : fresh).push(chart);
    if (key) seen.add(key);
  }
  return [...fresh.slice(0, first), ...again, ...fresh.slice(first)];
}

/** 新歌速递去掉横幅指向的歌与第一屏榜单卡露出的几首，留 `HOME_NEW_TRACK_COUNT` 首 */
export function freshTracks(
  tracks: readonly MusicTrack[],
  banners: readonly MusicBanner[],
  shownCharts: readonly MusicChart[],
): MusicTrack[] {
  const shown = new Set([
    ...banners.flatMap(({ target }) => (target.kind === 'track' ? [refKey(target.track.ref)] : [])),
    ...shownCharts.flatMap((chart) => chart.entries.map((entry) => refKey(entry.track.ref))),
  ]);
  return tracks.filter((track) => !shown.has(refKey(track.ref))).slice(0, HOME_NEW_TRACK_COUNT);
}
