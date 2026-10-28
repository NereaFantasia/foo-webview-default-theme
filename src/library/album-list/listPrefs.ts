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
import type { ColumnId } from '../../table/columns/columns.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { isTrackSortColumn, nextTrackSort } from '../../track/trackSort.ts';
import {
  DEFAULT_LIST_SORT,
  parseListSort,
  SECTION_ORDERS,
  startsDescending,
  type ListSort,
  type ListSortField,
  type SectionOrder,
} from './listSort.ts';

/** 随机种子的取值区间：32 位无符号整数 */
const SEED_RANGE = 2 ** 32;

function toSeed(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < SEED_RANGE
    ? raw
    : undefined;
}

// 列表形态自己的偏好：排序与封面墙各存一份，分节依据两种形态共用（在 `browserPrefs.ts`）
const PREFIX = 'defaultTheme.browser.';
const SORT = defineConfigPref<ListSort>(`${PREFIX}listSort`, DEFAULT_LIST_SORT, parseListSort);
const TRACK_SORT = defineConfigPref<Pick<TableSort, 'column' | 'descending'>>(
  `${PREFIX}listTrackSort`,
  { column: 'number', descending: false },
  (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const column: unknown = Reflect.get(raw, 'column');
    return isTrackSortColumn(column)
      ? { column, descending: Reflect.get(raw, 'descending') === true }
      : undefined;
  },
);
export const listTrackSortAtom: Atom<TableSort> = TRACK_SORT.atom;
const SEED = defineConfigPref(`${PREFIX}listShuffleSeed`, 0, toSeed);
// 专辑分组关掉后曲目平铺；节序方向没设过时跟着节序依据的缺省方向（名称升序、张数多的在前）
const ALBUM_GROUPS = defineConfigPref(`${PREFIX}listAlbumGroups`, true, (raw) =>
  typeof raw === 'boolean' ? raw : undefined,
);
const SECTION_DESCENDING = defineConfigPref<boolean | null>(
  `${PREFIX}listSectionDescending`,
  null,
  (raw) => (raw === null || typeof raw === 'boolean' ? raw : undefined),
);
const SECTION_ORDER = defineConfigPref<SectionOrder>(
  `${PREFIX}listSectionOrder`,
  'name',
  oneOf(SECTION_ORDERS),
);

export interface ListPrefs {
  readonly sort: ListSort;
  /** 随机排序的种子：洗出的顺序保持到下次再点「随机」，重启后也不变 */
  readonly seed: number;
  readonly sectionOrder: SectionOrder;
  /** 列表形态里专辑是一层分组；关掉后曲目平铺，列头排序作用于整份曲目 */
  readonly albumGroups: boolean;
  /** 节序的方向；没设过为 null，取节序依据的缺省方向 */
  readonly sectionDescending: boolean | null;
}

export const listPrefsAtom: Atom<ListPrefs> = atom((get) => ({
  sort: get(SORT.atom),
  seed: get(SEED.atom),
  sectionOrder: get(SECTION_ORDER.atom),
  albumGroups: get(ALBUM_GROUPS.atom),
  sectionDescending: get(SECTION_DESCENDING.atom),
}));

export interface ListPrefsService {
  readonly persistence: ConfigPersistence;
  /** 连上宿主、各项都读回或补写完时兑现，不会拒绝 */
  readonly ready: Promise<void>;
  /** 换排序字段，方向取新字段的缺省方向，同一个字段再点不动。点「随机」每点一次都换新种子，哪怕已经是随机：点一次洗一次 */
  setField(field: ListSortField): void;
  setDescending(descending: boolean): void;
  setSectionOrder(order: SectionOrder): void;
  setSectionDescending(descending: boolean): void;
  setAlbumGroups(grouped: boolean): void;
  /** 换列按它的缺省方向起，重复点击反向；有专辑分组时只影响各专辑内曲目，平铺时影响整份 */
  sortTracks(column: ColumnId): void;
  /** 排序菜单选的列与方向，同一份偏好；列不能排序时不动 */
  setTrackSort(sort: TableSort): void;
  dispose(): void;
}

/** 启动列表形态的偏好。`random` 缺省是 `Math.random`，给 [0, 1) 的数，用来洗新的种子 */
export function startListPrefs(
  store: Store,
  host: ConfigPrefFace = fb,
  random: () => number = Math.random,
  writer?: Pick<ConfigWriter, 'set'>,
): ListPrefsService {
  const prefs = startConfigPrefs(
    store,
    [SORT, TRACK_SORT, SEED, SECTION_ORDER, ALBUM_GROUPS, SECTION_DESCENDING],
    host,
    writer,
  );
  return {
    ready: prefs.ready,
    persistence: prefs,
    setField(field) {
      if (field === 'random') prefs.set(SEED, Math.floor(random() * SEED_RANGE) % SEED_RANGE);
      const current = store.get(SORT.atom);
      // 同一个字段再点（随机重洗）不动方向；换字段取新字段的缺省方向
      const descending = current.field === field ? current.descending : startsDescending(field);
      prefs.set(SORT, { field, descending });
    },
    setDescending: (descending) => prefs.set(SORT, { ...store.get(SORT.atom), descending }),
    setSectionOrder: (order) => prefs.set(SECTION_ORDER, order),
    setSectionDescending: (descending) => prefs.set(SECTION_DESCENDING, descending),
    setAlbumGroups: (grouped) => prefs.set(ALBUM_GROUPS, grouped),
    setTrackSort(sort) {
      if (isTrackSortColumn(sort.column))
        prefs.set(TRACK_SORT, { column: sort.column, descending: sort.descending });
    },
    sortTracks(column) {
      if (!isTrackSortColumn(column)) return;
      prefs.set(TRACK_SORT, nextTrackSort(store.get(TRACK_SORT.atom), column));
    },
    dispose: () => prefs.dispose(),
  };
}
