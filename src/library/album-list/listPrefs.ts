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
import {
  DEFAULT_LIST_SORT,
  parseListSort,
  SECTION_ORDERS,
  type ListSort,
  type ListSortField,
  type SectionOrder,
} from './listSort.ts';

/** 随机种子的取值区间：32 位无符号整数。 */
const SEED_RANGE = 2 ** 32;

function toSeed(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < SEED_RANGE
    ? raw
    : undefined;
}

// 列表形态自己的偏好：排序与封面墙各存一份，分节依据两种形态共用（在 `browserPrefs.ts`）。
const PREFIX = 'defaultTheme.browser.';
const SORT = defineConfigPref<ListSort>(`${PREFIX}listSort`, DEFAULT_LIST_SORT, parseListSort);
const SEED = defineConfigPref(`${PREFIX}listShuffleSeed`, 0, toSeed);
const SECTION_ORDER = defineConfigPref<SectionOrder>(
  `${PREFIX}listSectionOrder`,
  'name',
  oneOf(SECTION_ORDERS),
);

export interface ListPrefs {
  readonly sort: ListSort;
  /** 随机排序的种子：洗出的顺序保持到下次再点「随机」，重启后也不变。 */
  readonly seed: number;
  readonly sectionOrder: SectionOrder;
}

export const listPrefsAtom: Atom<ListPrefs> = atom((get) => ({
  sort: get(SORT.atom),
  seed: get(SEED.atom),
  sectionOrder: get(SECTION_ORDER.atom),
}));

export interface ListPrefsService {
  readonly persistence: ConfigPersistence;
  /** 连上宿主、三项都读回或补写完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /** 换排序字段，方向不变。点「随机」每点一次都换新种子，哪怕已经是随机：点一次洗一次。 */
  setField(field: ListSortField): void;
  setDescending(descending: boolean): void;
  setSectionOrder(order: SectionOrder): void;
  dispose(): void;
}

/** 启动列表形态的偏好。`random` 缺省是 `Math.random`，给 [0, 1) 的数，用来洗新的种子。 */
export function startListPrefs(
  store: Store,
  host: ConfigPrefFace = fb,
  random: () => number = Math.random,
  writer?: Pick<ConfigWriter, 'set'>,
): ListPrefsService {
  const prefs = startConfigPrefs(store, [SORT, SEED, SECTION_ORDER], host, writer);
  return {
    ready: prefs.ready,
    persistence: prefs,
    setField(field) {
      if (field === 'random') prefs.set(SEED, Math.floor(random() * SEED_RANGE) % SEED_RANGE);
      prefs.set(SORT, { ...store.get(SORT.atom), field });
    },
    setDescending: (descending) => prefs.set(SORT, { ...store.get(SORT.atom), descending }),
    setSectionOrder: (order) => prefs.set(SECTION_ORDER, order),
    dispose: () => prefs.dispose(),
  };
}
