import { atom, type Atom } from 'jotai/vanilla';
import type { PageTransitionKind } from '../motion/pageTransition.ts';
import type { Store } from '../kit/store.ts';
import { defaultTransition, samePlace, START_PLACE, type Place } from './places.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import {
  startHistory,
  type HistoryArrival,
  type HistoryEntry,
  type HistoryState,
  type HistoryService,
} from './historyStack.ts';

export { createSnapshotSlot } from './historyStack.ts';
export type { HistoryEntry, SnapshotSlot, SnapshotHooks, SubjectHooks } from './historyStack.ts';
export type Arrival = HistoryArrival<PageTransitionKind>;
export type NavHistoryState = HistoryState<Place, PageTransitionKind>;
/** 一个栈的完整服务，含把记录交给另一个栈用的几个方法；绑给组件与服务的 `NavHistoryService` 不含它们 */
export type StackHistoryService = HistoryService<Place, PageTransitionKind>;
export type NavHistoryService = Omit<
  StackHistoryService,
  'replace' | 'peek' | 'captureCurrent' | 'reenter'
>;

export const NAV_HISTORY_LIMIT = 50;

const INITIAL: NavHistoryState = {
  entry: { key: 0 },
  place: START_PLACE,
  previous: null,
  next: null,
  arrival: null,
};

const mainStateAtom = atom<NavHistoryState>(INITIAL);
const panelStateAtom = atom<NavHistoryState>(INITIAL);
const panelActiveAtom = atom(false);

/**
 * 主栈：沉浸视图的生命周期、全屏记账、主窗的中央区域与右侧卡认的是它。浏览面板开着时它一直停在 `nowPlaying`，
 * 所以认「沉浸是不是当前页」的地方读这个，不读 `historyAtom`
 */
export const mainHistoryAtom: Atom<NavHistoryState> = atom((get) => get(mainStateAtom));

/** 面板栈自己的状态，不论面板开没开；面板栈没起过时是初始值，不要读 */
export const panelHistoryAtom: Atom<NavHistoryState> = atom((get) => get(panelStateAtom));

/**
 * 此刻在用的那个栈：浏览面板开着时是面板栈，否则是主栈。页面与服务认「我是不是当前地点」读这个，
 * 面板里打开的页面因此与在主窗里打开时一样工作
 */
export const historyAtom: Atom<NavHistoryState> = atom((get) =>
  get(panelActiveAtom) ? get(panelStateAtom) : get(mainStateAtom),
);

/** 启动主视图路由历史服务（状态仅在内存中维护不持久化落盘，生命周期绑定当前窗口实例） */
export function startNavHistory(
  store: Store,
  start: Place = START_PLACE,
  limit: number = NAV_HISTORY_LIMIT,
): StackHistoryService {
  return startHistory(store, mainStateAtom, start, {
    same: samePlace,
    transition: (place) => defaultTransition(place.id),
    limit,
  });
}

/** 起浏览面板的栈；`first` 是主栈里那条记录的身份，沿用它页面快照才共用。由 `browserPanel.ts` 调 */
export function startPanelHistory(
  store: Store,
  start: Place,
  first?: HistoryEntry,
  limit: number = NAV_HISTORY_LIMIT,
): StackHistoryService {
  return startHistory(store, panelStateAtom, start, {
    same: samePlace,
    transition: (place) => defaultTransition(place.id),
    limit,
    first,
  });
}

/** 切换 `historyAtom` 指向哪个栈。由 `browserPanel.ts` 调 */
export function setPanelActive(store: Store, active: boolean): void {
  if (store.get(panelActiveAtom) !== active) store.set(panelActiveAtom, active);
}

export const historyKey = serviceKey<NavHistoryService>('history');
