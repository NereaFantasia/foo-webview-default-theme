import { atom, type Atom } from 'jotai/vanilla';
import type { NavDirection, PageTransitionKind } from '../motion/pageTransition.ts';
import type { Store } from '../kit/store.ts';
import { defaultTransition, samePlace, START_PLACE, type Place, type PlaceId } from './places.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 全局历史：一条，可后退、可前进；鼠标侧键、Alt+← / → 与标题栏的后退、前进键都走它。
 * 不落盘：它记的是这一次打开窗口里走过的路，重开窗口从头记。
 *
 * 一种页面同一时刻只有一份活的状态，所以每条记录另存页面的快照：离开时取，回到这条时交还。
 * 回来时先落主体（主体钩子的 `enter`），快照等页面登记快照钩子时才交还；页面在数据到齐之后才登记，
 * 滚动与焦点于是落在已经取回的数据上。
 */

/** 上限按一次听歌里来回走的路估，超出丢最早的。 */
export const NAV_HISTORY_LIMIT = 50;

/** 历史里的一条记录，对外只当身份用：页面按它登记快照钩子，中央区域按它区分新旧两层。 */
export interface HistoryEntry {
  readonly key: number;
}

interface Entry extends HistoryEntry {
  place: Place;
  /** 从上一条走到这一条用的过渡；从这一条后退时反着播。 */
  readonly arrivedBy: PageTransitionKind;
}

export interface Arrival {
  readonly kind: PageTransitionKind;
  readonly direction: NavDirection;
}

export interface NavHistoryState {
  readonly entry: HistoryEntry;
  readonly place: Place;
  /** 此刻后退会去的地点，已跳过主体不在的记录；后退键的悬停提示写它的名字。退不回去时为 null。 */
  readonly previous: Place | null;
  readonly next: Place | null;
  /** 怎么到的当前这条；打开窗口时的第一条为 null，不播过渡。 */
  readonly arrival: Arrival | null;
}

/** 一种带主体的地点的主体钩子。只有要跳过失效主体、要在回来时做动作的地点才登记。 */
export interface SubjectHooks {
  /** 同页主体被移走后，用户仍可在原记录里选另一个；列表等独立地点保持原有失效记录。 */
  readonly replaceMissing?: boolean;
  /** 页面此刻的主体。去这个地点没指明主体、离开时改写这条记录，都按它。 */
  current?(): string | null;
  exists(subject: string): boolean;
  /** 后退、前进回到这个主体时调，例如在宿主里重新激活那张列表。直接去一个地点时由调用方自己做。 */
  enter?(subject: string): void;
}

/** 放一种快照的地方：页面模块里建一个，快照按记录存在里面，形状由页面自己定。 */
export interface SnapshotSlot<S extends object> {
  readonly values: WeakMap<HistoryEntry, S>;
}

export function createSnapshotSlot<S extends object>(): SnapshotSlot<S> {
  return { values: new WeakMap() };
}

export interface SnapshotHooks<S extends object> {
  capture(): S;
  restore(snapshot: S): void;
}

export interface NavHistoryService {
  /** 去一个地点：与当前相同就不记；否则丢掉前进的部分再记一条。过渡缺省按地点层级定。 */
  navigate(place: Place, kind?: PageTransitionKind): void;
  /** 退到上一条还在的记录，跳过主体已经不在的；一条都没有时返回 false，哪儿也不去。 */
  back(): boolean;
  forward(): boolean;
  /** 登记一种地点的主体钩子，返回注销函数。 */
  registerSubject(id: PlaceId, hooks: SubjectHooks): () => void;
  /**
   * 主体的集合变了（列表删了、专辑移出媒体库、宿主激活了别的列表）时由主体的主人调：当前这条按页面
   * 此刻的主体改写（规则同离开时），再重算后退、前进会去哪。
   */
  subjectsChanged(): void;
  /**
   * 为一条记录登记一份快照钩子，返回注销函数；同一条记录可以登记多份，各用各的槽。
   * 登记时这条正是当前记录、槽里存着它的快照，就立即交还，每回到一次每个槽只交还一次；
   * 离开这条时取。没登记的页面离开时不取，已存的快照留着等下一次。
   */
  registerSnapshot<S extends object>(
    entry: HistoryEntry,
    slot: SnapshotSlot<S>,
    hooks: SnapshotHooks<S>,
  ): () => void;
}

interface Binding {
  readonly slot: object;
  capture(): void;
  restore(): void;
}

// 历史启动前是一条占位的起点，启动时立即换成真的第一条。
const stateAtom = atom<NavHistoryState>({
  entry: { key: 0 },
  place: START_PLACE,
  previous: null,
  next: null,
  arrival: null,
});

export const historyAtom: Atom<NavHistoryState> = atom((get) => get(stateAtom));

function sameOptionalPlace(a: Place | null, b: Place | null): boolean {
  return a === null || b === null ? a === b : samePlace(a, b);
}

function sameState(a: NavHistoryState, b: NavHistoryState): boolean {
  return (
    a.entry === b.entry &&
    samePlace(a.place, b.place) &&
    sameOptionalPlace(a.previous, b.previous) &&
    sameOptionalPlace(a.next, b.next) &&
    a.arrival?.kind === b.arrival?.kind &&
    a.arrival?.direction === b.arrival?.direction
  );
}

export function startNavHistory(
  store: Store,
  start: Place = START_PLACE,
  limit: number = NAV_HISTORY_LIMIT,
): NavHistoryService {
  let serial = 0;
  let entries: Entry[] = [{ key: ++serial, place: start, arrivedBy: 'refresh' }];
  let index = 0;
  const subjects = new Map<PlaceId, SubjectHooks>();
  const bindings = new Map<HistoryEntry, Set<Binding>>();
  // 这一次回到当前记录之后已经交还过快照的槽。
  let restored = new WeakSet<object>();
  // 后退、前进进行中：`enter` 会让主体的主人同步改状态、回调 `subjectsChanged`，这时改写或删记录会让
  // 已算好的去向指错。进行中只记一笔，到达之后再按新的当前记录同步。
  let stepping = false;
  let syncPending = false;

  const at = (i: number): Entry => {
    const entry = entries[i];
    if (!entry) throw new Error(`历史下标越界：${i}`);
    return entry;
  };

  function reachable(entry: Entry): boolean {
    const { id, subject } = entry.place;
    return subject === undefined || (subjects.get(id)?.exists(subject) ?? true);
  }

  function targetOf(direction: NavDirection): number | null {
    const delta = direction === 'back' ? -1 : 1;
    let target = index + delta;
    while (target >= 0 && target < entries.length && !reachable(at(target))) target += delta;
    return target >= 0 && target < entries.length ? target : null;
  }

  function placeAt(target: number | null): Place | null {
    return target === null ? null : at(target).place;
  }

  // 算出来与现有的一样就不写，读历史的组件不必跟着重渲染。
  function publish(arrival: Arrival | null): void {
    const entry = at(index);
    const next: NavHistoryState = {
      entry,
      place: entry.place,
      previous: placeAt(targetOf('back')),
      next: placeAt(targetOf('forward')),
      arrival,
    };
    if (!sameState(store.get(stateAtom), next)) store.set(stateAtom, next);
  }

  function withSubject(place: Place): Place {
    if (place.subject !== undefined) return place;
    const subject = subjects.get(place.id)?.current?.() ?? null;
    return subject === null ? place : { id: place.id, subject };
  }

  // 主体可能在历史之外被换掉（宿主激活了另一张列表），离开或比较之前按页面此刻的主体改写当前这条。
  // 这条原来的主体已经不在（列表删了）时不改写：页面此刻的主体已是另一张（删的是活动列表时会切到
  // 落在同一位的那张），改过去等于把记录挪到了另一个地点；留着原主体，后退、前进时按「主体不在就跳过」
  // 越过它。改写后，后退、前进会去的那条（已跳过主体不在的）与它同一地点时，去掉那一条，免得原地不动；
  // 当前这条留着，它的快照最新。
  function syncSubject(): void {
    const entry = at(index);
    const hooks = subjects.get(entry.place.id);
    const subject = hooks?.current?.() ?? null;
    if (subject === null || subject === entry.place.subject) return;
    const own = entry.place.subject;
    if (own !== undefined && hooks && !hooks.exists(own) && !hooks.replaceMissing) return;
    entry.place = { id: entry.place.id, subject };
    const next = targetOf('forward');
    if (next !== null && samePlace(at(next).place, entry.place)) entries.splice(next, 1);
    const previous = targetOf('back');
    if (previous !== null && samePlace(at(previous).place, entry.place)) {
      entries.splice(previous, 1);
      index -= 1;
    }
  }

  function capture(entry: Entry): void {
    for (const binding of bindings.get(entry) ?? []) binding.capture();
  }

  function restoreOnce(binding: Binding): void {
    if (restored.has(binding.slot)) return;
    restored.add(binding.slot);
    binding.restore();
  }

  function arrive(target: number, arrival: Arrival): void {
    index = target;
    restored = new WeakSet();
    const entry = at(index);
    for (const binding of bindings.get(entry) ?? []) restoreOnce(binding);
    publish(arrival);
  }

  function step(direction: NavDirection): boolean {
    syncSubject();
    const target = targetOf(direction);
    if (target === null) return false;
    const leaving = at(index);
    capture(leaving);
    const kind = direction === 'back' ? leaving.arrivedBy : at(target).arrivedBy;
    const { id, subject } = at(target).place;
    stepping = true;
    try {
      if (subject !== undefined) subjects.get(id)?.enter?.(subject);
    } finally {
      stepping = false;
    }
    arrive(target, { kind, direction });
    if (syncPending) {
      syncPending = false;
      syncSubject();
      publish(store.get(stateAtom).arrival);
    }
    return true;
  }

  publish(null);

  return {
    navigate(requested, kind = defaultTransition(requested.id)) {
      const place = withSubject(requested);
      syncSubject();
      const leaving = at(index);
      if (samePlace(place, leaving.place)) {
        publish(store.get(stateAtom).arrival);
        return;
      }
      capture(leaving);
      const kept = [...entries.slice(0, index + 1), { key: ++serial, place, arrivedBy: kind }];
      entries = kept.slice(Math.max(0, kept.length - limit));
      arrive(entries.length - 1, { kind, direction: 'forward' });
    },
    back: () => step('back'),
    forward: () => step('forward'),
    registerSubject(id, hooks) {
      subjects.set(id, hooks);
      publish(store.get(stateAtom).arrival);
      return () => {
        if (subjects.get(id) === hooks) subjects.delete(id);
      };
    },
    subjectsChanged() {
      if (stepping) {
        syncPending = true;
        return;
      }
      syncSubject();
      publish(store.get(stateAtom).arrival);
    },
    registerSnapshot(entry, slot, hooks) {
      const binding: Binding = {
        slot,
        capture: () => slot.values.set(entry, hooks.capture()),
        restore: () => {
          const snapshot = slot.values.get(entry);
          if (snapshot) hooks.restore(snapshot);
        },
      };
      let set = bindings.get(entry);
      if (!set) bindings.set(entry, (set = new Set()));
      set.add(binding);
      if (entry === at(index)) restoreOnce(binding);
      return () => {
        set.delete(binding);
        if (set.size === 0 && bindings.get(entry) === set) bindings.delete(entry);
      };
    },
  };
}

export const historyKey = serviceKey<NavHistoryService>('history');
