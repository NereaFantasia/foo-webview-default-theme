import type { ConfigWriter } from '../../host/configWrite.ts';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  oneOf,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../../host/configPref.ts';
import {
  parseListSort,
  startsDescending,
  type ListSort,
  type ListSortField,
} from '../album-list/listSort.ts';
import type { Store } from '../../kit/store.ts';
import { browserStorage, defineLocalPref, type PrefStorage } from '../../kit/localPref.ts';
import { GRID_STYLES, type GridStyle } from '../album-wall/albumGridLayout.ts';
import {
  ALBUM_SORTS,
  SECTION_DIMENSIONS,
  type AlbumSort,
  type SectionDimension,
} from '../albumSections.ts';

/** 专辑页的两种形态：封面墙与列表。按页面记住，切换不进历史 */
export const ALBUM_FORMS = ['wall', 'list'] as const;
export type AlbumForm = (typeof ALBUM_FORMS)[number];

/**
 * 图块边长的区间，CSS 像素。存的就是画出来的边长，不随内容卡宽度变。下限是两行 12 px 字还读得出
 * 的边长；上限在整数倍像素比下正落在取图的 256 / 384 / 512 档上，不重采样。滑块与滚轮一格走一步
 */
export const TILE_SIZE_MIN = 128;
export const TILE_SIZE_MAX = 256;
export const TILE_SIZE_STEP = 8;
export const TILE_SIZE_DEFAULT = 160;

/** 边长越界是「到头了」而不是「非法」，夹回区间；旧存档里的值也照此归位 */
function toTileSize(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.min(TILE_SIZE_MAX, Math.max(TILE_SIZE_MIN, Math.round(raw)));
}

// 键名与取值沿用已发布的版本，用户的设置原样读回；改名要写迁移
const PREFIX = 'defaultTheme.browser.';
const DIMENSION = defineConfigPref<SectionDimension>(
  `${PREFIX}dimension`,
  'album',
  oneOf(SECTION_DIMENSIONS),
);
const SORT = defineConfigPref<AlbumSort>(`${PREFIX}sort`, 'name', oneOf(ALBUM_SORTS));
const STYLE = defineConfigPref<GridStyle>(`${PREFIX}style`, 'grid', oneOf(GRID_STYLES));
const TILE_SIZE = defineConfigPref(`${PREFIX}tileSize`, TILE_SIZE_DEFAULT, toTileSize);
const FORM = defineConfigPref<AlbumForm>(`${PREFIX}form`, 'wall', oneOf(ALBUM_FORMS));

// 未设置独立排序时按已有字段及其默认方向显示，不重写已有存档
const WALL_SORT = defineConfigPref<ListSort | null>(`${PREFIX}wallSort.v1`, null, (raw) =>
  raw === null ? null : parseListSort(raw),
);
const WALL_SEED = defineConfigPref(`${PREFIX}wallShuffleSeed`, 0, (raw) =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < 2 ** 32 ? raw : undefined,
);

export const wallSortAtom = atom((get) => {
  const legacy = get(SORT.atom);
  return {
    sort: get(WALL_SORT.atom) ?? {
      field: legacy === 'artist' ? 'albumArtist' : legacy,
      descending: legacy === 'year' || legacy === 'trackCount',
    },
    seed: get(WALL_SEED.atom),
    custom: get(WALL_SORT.atom) !== null,
  };
});

export interface BrowserPrefs {
  readonly dimension: SectionDimension;
  readonly sort: AlbumSort;
  readonly style: GridStyle;
  /** 已夹在 `TILE_SIZE_MIN` 至 `TILE_SIZE_MAX` */
  readonly tileSize: number;
  readonly form: AlbumForm;
}

export const browserPrefsAtom: Atom<BrowserPrefs> = atom((get) => ({
  dimension: get(DIMENSION.atom),
  sort: get(SORT.atom),
  style: get(STYLE.atom),
  tileSize: get(TILE_SIZE.atom),
  form: get(FORM.atom),
}));

/** 筛选是嵌入页面还是弹出浮层：界面偏好，只在这台机器上记住；缺省弹出 */
export const ALBUMS_FILTER_KEY = 'default-theme.albums-filter.v1';
const DOCK = defineLocalPref<boolean>({
  key: ALBUMS_FILTER_KEY,
  fallback: false,
  parse: (raw) => (raw === 'docked' ? true : raw === 'popover' ? false : undefined),
  format: (docked) => (docked ? 'docked' : 'popover'),
});
export const albumsFilterDockedAtom: Atom<boolean> = DOCK.atom;

export interface BrowserPrefsService {
  readonly persistence: ConfigPersistence;
  /** 连上宿主、偏好读回完成时兑现，不会拒绝 */
  readonly ready: Promise<void>;
  setDimension(value: SectionDimension): void;
  setSort(value: AlbumSort): void;
  setWallSort(sort: ListSort): void;
  setWallField(field: ListSortField): void;
  setStyle(value: GridStyle): void;
  /** 越界的值夹到端点，不丢弃 */
  setTileSize(value: number): void;
  setForm(value: AlbumForm): void;
  setFilterDocked(docked: boolean): void;
  dispose(): void;
}

/** 启动专辑页的偏好：分节、排序、显示样式、图块边长与形态，随 profile 记住 */
export function startBrowserPrefs(
  store: Store,
  host: ConfigPrefFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
  storage: PrefStorage | null = browserStorage(),
): BrowserPrefsService {
  let disposed = false;
  DOCK.load(store, storage);
  const prefs = startConfigPrefs(
    store,
    [DIMENSION, SORT, STYLE, TILE_SIZE, FORM, WALL_SORT, WALL_SEED],
    host,
    writer,
  );
  return {
    ready: prefs.ready,
    persistence: prefs,
    setDimension: (value) => prefs.set(DIMENSION, value),
    setSort: (value) => prefs.set(SORT, value),
    setWallSort: (sort) => prefs.set(WALL_SORT, sort),
    setWallField(field) {
      if (field === 'random') void prefs.set(WALL_SEED, Math.floor(Math.random() * 2 ** 32));
      const current = store.get(wallSortAtom).sort;
      const descending = current.field === field ? current.descending : startsDescending(field);
      void prefs.set(WALL_SORT, { field, descending });
    },
    setStyle: (value) => prefs.set(STYLE, value),
    setTileSize: (value) => prefs.set(TILE_SIZE, value),
    setForm: (value) => prefs.set(FORM, value),
    setFilterDocked: (docked) => {
      if (!disposed) DOCK.set(store, docked, storage);
    },
    dispose() {
      disposed = true;
      prefs.dispose();
    },
  };
}
