import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';

/**
 * 按 GUID 记哪几张列表有页面在要，服务据此只为这几张订阅、取数。同一张同时被几处要（切换动画里离场与
 * 入场的两层）时共用一份；都放手后晚一个微任务再关：页面在同一次提交里卸下又挂上（StrictMode 的二次
 * effect）时那一份留着，不重开。
 */
export interface Holds<T> {
  /** 要这张列表：没人要时现开一份；返回的函数放手，调几次都只算一次。 */
  acquire(guid: string): () => void;
  get(guid: string): T | undefined;
  /** 此刻有人要的几张，按开的先后。 */
  entries(): [string, T][];
  /** 全部关掉，之后的 acquire 不再开新的。 */
  dispose(): void;
}

/** 每张列表一格状态：服务按 GUID 写，页面按 GUID 读；同一 GUID 总是同一对原子，没人要时停在初值。 */
export interface Slots<S> {
  /** 可写的那一格，只在服务里用。 */
  own(guid: string): PrimitiveAtom<S>;
  /** 对外的只读那一面。 */
  view(guid: string): Atom<S>;
}

export function createSlots<S>(initial: S): Slots<S> {
  const slots = new Map<string, { own: PrimitiveAtom<S>; view: Atom<S> }>();
  const slotOf = (guid: string) => {
    let slot = slots.get(guid);
    if (!slot) {
      const own = atom(initial);
      slot = { own, view: atom((get) => get(own)) };
      slots.set(guid, slot);
    }
    return slot;
  };
  return { own: (guid) => slotOf(guid).own, view: (guid) => slotOf(guid).view };
}

export function createHolds<T>(
  open: (guid: string) => T,
  close: (entry: T, guid: string) => void,
): Holds<T> {
  const held = new Map<string, { readonly entry: T; holders: number }>();
  let disposed = false;
  return {
    acquire(guid) {
      if (disposed) return () => {};
      let slot = held.get(guid);
      if (!slot) {
        slot = { entry: open(guid), holders: 0 };
        held.set(guid, slot);
      }
      const mine = slot;
      mine.holders += 1;
      let holding = true;
      return () => {
        if (!holding) return;
        holding = false;
        mine.holders -= 1;
        queueMicrotask(() => {
          if (disposed || mine.holders > 0 || held.get(guid) !== mine) return;
          held.delete(guid);
          close(mine.entry, guid);
        });
      };
    },
    get: (guid) => held.get(guid)?.entry,
    entries: () => [...held].map(([guid, slot]) => [guid, slot.entry]),
    dispose() {
      disposed = true;
      for (const [guid, slot] of held) close(slot.entry, guid);
      held.clear();
    },
  };
}
