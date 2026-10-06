import type { ConfigWriter } from '../../host/configWrite.ts';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../../host/configPref.ts';
import type { Store } from '../../kit/store.ts';
import { SECTION_DIMENSIONS, type SectionDimension } from '../albumSections.ts';
import { browserPrefsAtom } from './browserPrefs.ts';

/** 有节头、能折叠的分节依据；平铺档没有节头。 */
export type FoldableDimension = Exclude<SectionDimension, 'album'>;

const FOLDABLE = SECTION_DIMENSIONS.filter(
  (dimension): dimension is FoldableDimension => dimension !== 'album',
);

/**
 * 每个分节依据最多记这么多个折叠的节，多了丢最早折叠的：文件夹档的节键是完整路径，会一直攒。列表形态里
 * 与缺省相反的专辑也最多记这么多张。
 */
export const COLLAPSED_LIMIT = 500;

/** 一种形态下各分节依据折叠了的节，数组按折叠的先后。 */
export type FoldedSections = Partial<Record<FoldableDimension, (string | null)[]>>;

/**
 * 折叠了哪些节，存进宿主 config：`{ wall: { <分节依据>: [节键, …] } }`，节键 null 是「未知」节，
 * 数组按折叠的先后。按分节依据分开记：流派档的「未知」与文件夹档的「未知」不是同一节。
 * 按形态分开放：列表形态的节记在并列的 `list` 里，专辑分组记在 `listAlbums` 里：缺省折不折，加上与缺省
 * 相反的那些专辑键。两项没折过时不写，只有 `wall` 的旧存档原样读回。
 *
 * 写成 type 而不是 interface：interface 没有隐式的索引签名，赋不给 config 收的 JSON 值类型。
 */
export type CollapsedSections = {
  wall: FoldedSections;
  list?: FoldedSections;
  listAlbums?: { collapsedByDefault: boolean; except: string[] };
};

const NO_COLLAPSED: CollapsedSections = { wall: {} };

function isFoldable(dimension: SectionDimension): dimension is FoldableDimension {
  return dimension !== 'album';
}

function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 一个分节依据下的节键：只留字符串与 null，去重，超出上限丢最早的。 */
function keysOf(raw: unknown): (string | null)[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values: unknown[] = raw;
  const keys = new Set<string | null>();
  for (const value of values) {
    if (typeof value === 'string' || value === null) keys.add(value);
  }
  return [...keys].slice(-COLLAPSED_LIMIT);
}

function sectionsOf(raw: unknown): FoldedSections {
  const folded: FoldedSections = {};
  if (!isPlainObject(raw)) return folded;
  for (const dimension of FOLDABLE) {
    const keys = keysOf(Reflect.get(raw, dimension));
    if (keys && keys.length > 0) folded[dimension] = keys;
  }
  return folded;
}

/** 列表形态的专辑分组：缺省不是布尔值当展开；例外只留字符串，去重，超出上限丢最早的。 */
function listAlbumsOf(raw: unknown): CollapsedSections['listAlbums'] {
  if (!isPlainObject(raw)) return undefined;
  const collapsedByDefault = Reflect.get(raw, 'collapsedByDefault') === true;
  const except = (keysOf(Reflect.get(raw, 'except')) ?? []).filter(
    (key): key is string => key !== null,
  );
  return collapsedByDefault || except.length > 0 ? { collapsedByDefault, except } : undefined;
}

/**
 * 读回与写入都过它：整份不是对象时答 undefined，当没存；不认的分节依据、不是数组的值、不是字符串也
 * 不是 null 的节键都丢掉，其余照用。列表形态的两项没有内容时不出现。
 */
export function parseCollapsed(raw: unknown): CollapsedSections | undefined {
  if (!isPlainObject(raw)) return undefined;
  const value: CollapsedSections = { wall: sectionsOf(Reflect.get(raw, 'wall')) };
  const list = sectionsOf(Reflect.get(raw, 'list'));
  if (Object.keys(list).length > 0) value.list = list;
  const listAlbums = listAlbumsOf(Reflect.get(raw, 'listAlbums'));
  if (listAlbums) value.listAlbums = listAlbums;
  return value;
}

/** 封面墙在这个分节依据下折叠了哪些节；平铺档恒为空。 */
function collapsedIn(
  value: CollapsedSections,
  dimension: SectionDimension,
): ReadonlySet<string | null> {
  return new Set(isFoldable(dimension) ? (value.wall[dimension] ?? []) : []);
}

/** 折叠或展开一节，答新的一份；原来的不改。平铺档原样答回。 */
function toggleCollapsed(
  value: CollapsedSections,
  dimension: SectionDimension,
  key: string | null,
): CollapsedSections {
  if (!isFoldable(dimension)) return value;
  const keys = value.wall[dimension] ?? [];
  const next = keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
  return { ...value, wall: { ...value.wall, [dimension]: next.slice(-COLLAPSED_LIMIT) } };
}

const COLLAPSED = defineConfigPref<CollapsedSections>(
  'defaultTheme.browser.collapsed',
  NO_COLLAPSED,
  parseCollapsed,
);

/** 封面墙在当前分节依据下折叠了的节，按节键；null 是「未知」节。 */
export const collapsedSectionsAtom: Atom<ReadonlySet<string | null>> = atom((get) =>
  collapsedIn(get(COLLAPSED.atom), get(browserPrefsAtom).dimension),
);

/** 存着的整份，两种形态都在里面；列表形态从这里算自己的折叠。 */
export const collapsedValueAtom: Atom<CollapsedSections> = COLLAPSED.atom;

export interface CollapsedSectionsService {
  readonly persistence: ConfigPersistence;
  /** 连上宿主、存档读回或补写完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /** 折叠或展开当前分节依据下的一节，并记进 config；平铺档没有节可折。 */
  toggle(key: string | null): void;
  /** 按 `change` 改整份并记进 config：列表形态的批量开合走这里。改出来的先过 `parseCollapsed`。 */
  update(change: (value: CollapsedSections) => CollapsedSections): void;
  dispose(): void;
}

/** 启动折叠状态：跨重启记住，按分节依据分开。分节依据取自 `browserPrefsAtom`。 */
export function startCollapsedSections(
  store: Store,
  host: ConfigPrefFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): CollapsedSectionsService {
  const prefs = startConfigPrefs(store, [COLLAPSED], host, writer);
  return {
    ready: prefs.ready,
    persistence: prefs,
    toggle(key) {
      const { dimension } = store.get(browserPrefsAtom);
      prefs.set(COLLAPSED, toggleCollapsed(store.get(COLLAPSED.atom), dimension, key));
    },
    update(change) {
      const next = parseCollapsed(change(store.get(COLLAPSED.atom)));
      if (next) prefs.set(COLLAPSED, next);
    },
    dispose: () => prefs.dispose(),
  };
}
