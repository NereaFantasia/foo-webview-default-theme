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
import type { Store } from '../../kit/store.ts';
import { GRID_STYLES, type GridStyle } from '../album-wall/albumGridLayout.ts';
import {
  ALBUM_SORTS,
  SECTION_DIMENSIONS,
  type AlbumSort,
  type SectionDimension,
} from '../albumSections.ts';

/** 专辑页的两种形态：封面墙与列表。按页面记住，切换不进历史。 */
export const ALBUM_FORMS = ['wall', 'list'] as const;
export type AlbumForm = (typeof ALBUM_FORMS)[number];

/**
 * 图块边长的区间，CSS 像素。存的就是画出来的边长，不随内容卡宽度变。下限是两行 12 px 字还读得出
 * 的边长；上限在整数倍像素比下正落在取图的 256 / 384 / 512 档上，不重采样。滑块与滚轮一格走一步。
 */
export const TILE_SIZE_MIN = 128;
export const TILE_SIZE_MAX = 256;
export const TILE_SIZE_STEP = 8;
export const TILE_SIZE_DEFAULT = 160;

/** 边长越界是「到头了」而不是「非法」，夹回区间；旧存档里的值也照此归位。 */
function toTileSize(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.min(TILE_SIZE_MAX, Math.max(TILE_SIZE_MIN, Math.round(raw)));
}

// 键名与取值沿用已发布的版本，用户的设置原样读回；改名要写迁移。
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

export interface BrowserPrefs {
  readonly dimension: SectionDimension;
  readonly sort: AlbumSort;
  readonly style: GridStyle;
  /** 已夹在 `TILE_SIZE_MIN` 至 `TILE_SIZE_MAX`。 */
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

export interface BrowserPrefsService {
  readonly persistence: ConfigPersistence;
  /** 连上宿主、五项都读回或补写完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  setDimension(value: SectionDimension): void;
  setSort(value: AlbumSort): void;
  setStyle(value: GridStyle): void;
  /** 越界的值夹到端点，不丢弃。 */
  setTileSize(value: number): void;
  setForm(value: AlbumForm): void;
  dispose(): void;
}

/** 启动专辑页的偏好：分节、排序、显示样式、图块边长与形态，随 profile 记住。 */
export function startBrowserPrefs(
  store: Store,
  host: ConfigPrefFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): BrowserPrefsService {
  const prefs = startConfigPrefs(store, [DIMENSION, SORT, STYLE, TILE_SIZE, FORM], host, writer);
  return {
    ready: prefs.ready,
    persistence: prefs,
    setDimension: (value) => prefs.set(DIMENSION, value),
    setSort: (value) => prefs.set(SORT, value),
    setStyle: (value) => prefs.set(STYLE, value),
    setTileSize: (value) => prefs.set(TILE_SIZE, value),
    setForm: (value) => prefs.set(FORM, value),
    dispose: () => prefs.dispose(),
  };
}
