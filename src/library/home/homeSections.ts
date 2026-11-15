import { atom, type Atom } from 'jotai/vanilla';
import type { MessageKey } from '../../i18n/en.ts';
import { moveOrder } from '../../kit/listReorder.ts';
import { defineLocalPref } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';

/**
 * 首页里可以在设置中关闭、挪动的行，按缺省次序排列，带各自的行名。
 * 「我的频道」是新建与管理频道的唯一入口，常驻页尾，不在其中
 */
export const HOME_SECTIONS = [
  { id: 'quick', label: 'home.quick' },
  { id: 'banners', label: 'home.banners' },
  { id: 'added', label: 'home.added' },
  { id: 'new-tracks', label: 'home.newTracks' },
  { id: 'charts', label: 'home.charts' },
  { id: 'playlists', label: 'home.playlists' },
  { id: 'gems', label: 'home.rediscover' },
  { id: 'releases', label: 'home.releases' },
  { id: 'most-played', label: 'home.mostPlayed' },
  { id: 'overview', label: 'home.library' },
] as const satisfies readonly { readonly id: string; readonly label: MessageKey }[];

export type HomeSection = (typeof HOME_SECTIONS)[number]['id'];

/** 在线的几行：都关掉时不必再劝人下载网易云组件 */
export const HOME_ONLINE_SECTIONS = [
  'banners',
  'new-tracks',
  'charts',
  'playlists',
  'releases',
] as const satisfies readonly HomeSection[];

/** 要读播放统计的几行：都关掉时首页不读 */
export const HOME_STATISTICS_SECTIONS = [
  'quick',
  'gems',
  'most-played',
  'overview',
] as const satisfies readonly HomeSection[];

/** 首页的一行在这台机器上的摆法：排第几、是否开启 */
export interface HomeSlot {
  readonly id: HomeSection;
  readonly shown: boolean;
}

export const HOME_SECTIONS_KEY = 'default-theme.home-layout.v1';

const isSection = (value: string): value is HomeSection =>
  HOME_SECTIONS.some(({ id }) => id === value);

/** 开着的行在前、关掉的在后，各自保持原有的相对次序：编辑时只排开着的行，关掉的行加回来排在它们末尾 */
const visibleFirst = (layout: readonly HomeSlot[]): readonly HomeSlot[] => [
  ...layout.filter((slot) => slot.shown),
  ...layout.filter((slot) => !slot.shown),
];

const DEFAULT_LAYOUT: readonly HomeSlot[] = HOME_SECTIONS.map(({ id }) => ({ id, shown: true }));

/**
 * 存档是按页面次序排列的行名，逗号分隔，名字前带 `-` 的是关闭的行。
 * 无法识别与重复的名字丢弃，之后新增的行缺省显示，排在末尾
 */
function parseLayout(raw: string): readonly HomeSlot[] {
  const slots: HomeSlot[] = [];
  for (const token of raw.split(',')) {
    const id = token.startsWith('-') ? token.slice(1) : token;
    if (isSection(id) && !slots.some((slot) => slot.id === id))
      slots.push({ id, shown: id === token });
  }
  for (const { id } of HOME_SECTIONS) {
    if (!slots.some((slot) => slot.id === id)) slots.push({ id, shown: true });
  }
  return visibleFirst(slots);
}

const pref = defineLocalPref<readonly HomeSlot[]>({
  key: HOME_SECTIONS_KEY,
  fallback: DEFAULT_LAYOUT,
  parse: parseLayout,
  format: (layout) => layout.map(({ id, shown }) => (shown ? id : `-${id}`)).join(','),
});

/** 全部行按页面上的次序，含关掉的；`loadHomeSections` 之前是缺省次序、全开 */
export const homeLayoutAtom: Atom<readonly HomeSlot[]> = pref.atom;

/** 关掉的行 */
export const homeHiddenSectionsAtom: Atom<readonly HomeSection[]> = atom((get) =>
  get(pref.atom)
    .filter((slot) => !slot.shown)
    .map((slot) => slot.id),
);

/** 读取存档并写入 `store`。首页的服务装配时调用一次 */
export function loadHomeSections(store: Store): void {
  pref.load(store);
}

/** 打开或关闭一行，立即生效并写回存档。打开的行排在已开启的行之后 */
export function showHomeSection(store: Store, section: HomeSection, shown: boolean): void {
  const rest = store.get(pref.atom).filter((slot) => slot.id !== section);
  pref.set(store, visibleFirst([...rest, { id: section, shown }]));
}

/**
 * 把已开启的一行挪到插入位 `slot`：取值 0 到已开启的行数，k 表示插在第 k 行之前，等于已开启的行数表示放到末尾。
 * 落在原位、越界，或这一行没有开启时不移动
 */
export function placeHomeSection(store: Store, section: HomeSection, slot: number): void {
  const layout = store.get(pref.atom);
  const visible = layout.filter((item) => item.shown);
  const order = moveOrder(
    visible.length,
    visible.findIndex((item) => item.id === section),
    slot,
  );
  if (!order) return;
  pref.set(store, [
    ...order.flatMap((at) => visible[at] ?? []),
    ...layout.filter((item) => !item.shown),
  ]);
}

/** 恢复缺省次序，并全部打开 */
export function resetHomeSections(store: Store): void {
  pref.set(store, DEFAULT_LAYOUT);
}

/** 这几行里至少有一行开着 */
export function anyHomeSectionShown(
  hidden: readonly HomeSection[],
  sections: readonly HomeSection[],
): boolean {
  return sections.some((section) => !hidden.includes(section));
}
