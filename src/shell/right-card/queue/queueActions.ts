import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import type { QueueEntry, QueueStateService } from './queueState.ts';
import {
  applyTransition,
  consumedSince,
  planTransition,
  shapeOf,
  withoutPlayed,
  type QueueShape,
  type QueueTransitionFace,
} from './queueTransition.ts';

export interface QueueActionsFace extends QueueTransitionFace {
  queue: QueueTransitionFace['queue'] & Pick<typeof fb.queue, 'clear' | 'moveToTop' | 'playNow'>;
}

/** 撤销那一步的状态，菜单与按键据此置灰；`cleared` 是刚清空了几首，轻提示用，提示收起后清掉。 */
export interface QueueUndoState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly cleared: number | null;
}

const IDLE: QueueUndoState = { canUndo: false, canRedo: false, cleared: null };
const undoAtom = atom<QueueUndoState>(IDLE);

export const queueUndoAtom: Atom<QueueUndoState> = atom((get) => get(undoAtom));

export interface QueueActions {
  /** 立即播放这一首，排在它前面的跳过；不进撤销。 */
  playNow(key: string): Promise<boolean>;
  moveToTop(key: string): Promise<boolean>;
  remove(keys: readonly string[]): Promise<boolean>;
  /** 只留这一首。 */
  keepOnly(key: string): Promise<boolean>;
  clear(): Promise<boolean>;
  /** 把这几首（按队列里的先后）挪到 `before` 那一首前面；`before` 为 null 挪到队尾。 */
  move(keys: readonly string[], before: string | null): Promise<boolean>;
  /** 这几首各往前（-1）或往后（1）挪一位，挨着的一起走。 */
  shift(keys: readonly string[], delta: -1 | 1): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  dismissCleared(): void;
}

/** 只记一步：改动前后各一份队列的样子，撤销时从 `after` 回到 `before`，重做反过来。 */
interface Step {
  readonly before: QueueShape;
  readonly after: QueueShape;
  readonly undone: boolean;
}

/** 按新顺序重排时的下标表：新顺序里每一条在此刻队列里的下标。 */
function reorder(entries: readonly QueueEntry[], next: readonly QueueEntry[]): number[] | null {
  const indices = next.map((entry) => entries.indexOf(entry));
  return indices.some((index, position) => index !== position) ? indices : null;
}

/**
 * 队列的命令。宿主按下标改队列、不校验版本，所以每条命令先现读一次整份队列，把行的身份对成此刻的下标再发；
 * 读回里找不到的行（已经播掉或被别处移除）不算。读与改之间刚好换曲，下标会差一位，窗口只有一次往返，接受。
 *
 * 撤销只记最近一步（移除、清空、调顺序、移到队首）。撤销前现读：此刻的队列得是那一步之后的样子、最多从队首
 * 又播掉了几首，否则说明队列在别处被改过，这一步作废。期间播掉的不放回，补回的条目不带列表位置。
 */
export function createQueueActions(
  store: Store,
  state: Pick<QueueStateService, 'refresh'>,
  host: QueueActionsFace = fb,
): QueueActions {
  store.set(undoAtom, IDLE);
  let step: Step | null = null;
  const ok = (answer: { success?: unknown } | null) => answer?.success === true;

  const publish = (cleared: number | null = store.get(undoAtom).cleared) => {
    store.set(undoAtom, {
      canUndo: step !== null && !step.undone,
      canRedo: step !== null && step.undone,
      cleared,
    });
  };

  const record = (before: QueueShape, after: QueueShape, cleared: number | null = null) => {
    step = { before, after, undone: false };
    publish(cleared);
  };

  /** 现读，并把这几行对成下标；读不到答 null。 */
  async function locate(keys: readonly string[]) {
    const entries = await state.refresh();
    if (!entries) return null;
    const wanted = new Set(keys);
    const hits = entries.filter((entry) => wanted.has(entry.key));
    return { entries, hits, indices: hits.map((entry) => entries.indexOf(entry)) };
  }

  async function rearrange(
    entries: readonly QueueEntry[],
    next: readonly QueueEntry[],
  ): Promise<boolean> {
    const indices = reorder(entries, next);
    if (!indices) return true;
    const items = indices.map((queueIndex) => ({ queueIndex }));
    if (!ok(await settle(() => host.queue.setContents(items)))) return false;
    record(shapeOf(entries), shapeOf(next));
    return true;
  }

  async function travel(undo: boolean): Promise<boolean> {
    const current = step;
    if (!current || current.undone !== !undo) return false;
    const entries = await state.refresh();
    if (!entries) return false;
    const now = shapeOf(entries);
    const from = undo ? current.after : current.before;
    const taken = consumedSince(from, now);
    if (taken === null) {
      // 队列在别处被改过，这一步作废、什么也不做。这不是命令失败，不答 false，免得提示「请再试一次」。
      step = null;
      publish(null);
      return true;
    }
    const target = withoutPlayed(undo ? current.before : current.after, from.slice(0, taken));
    if (!(await applyTransition(host, planTransition(now, target)))) return false;
    // 两端都记扣掉已播放曲目后的序列，否则下一次撤销或重做会把它们放回。
    step = undo
      ? { before: target, after: now, undone: true }
      : { before: now, after: target, undone: false };
    publish(null);
    return true;
  }

  async function remove(keys: readonly string[]): Promise<boolean> {
    const found = await locate(keys);
    if (!found || found.indices.length === 0) return false;
    if (!ok(await settle(() => host.queue.remove([...found.indices])))) return false;
    const gone = new Set(found.hits);
    record(shapeOf(found.entries), shapeOf(found.entries.filter((entry) => !gone.has(entry))));
    return true;
  }

  const direct: QueueActions = {
    async playNow(key) {
      const found = await locate([key]);
      const index = found?.indices[0];
      if (index === undefined) return false;
      const target = found?.entries[index];
      if (!target) return false;
      if (index > 0) {
        const skipped = Array.from({ length: index }, (_, at) => at);
        if (!ok(await settle(() => host.queue.remove(skipped)))) {
          return false;
        }
      }
      const done = ok(await settle(() => host.queue.playNow(0)));
      return done;
    },
    async moveToTop(key) {
      const found = await locate([key]);
      const index = found?.indices[0];
      if (!found || index === undefined) return false;
      if (index === 0) return true;
      if (!ok(await settle(() => host.queue.moveToTop(index)))) return false;
      const hit = found.entries[index];
      const rest = found.entries.filter((_, at) => at !== index);
      record(shapeOf(found.entries), shapeOf(hit ? [hit, ...rest] : rest));
      return true;
    },
    remove,
    async keepOnly(key) {
      const entries = await state.refresh();
      if (!entries?.some((entry) => entry.key === key)) return false;
      const others = entries.filter((entry) => entry.key !== key);
      return others.length === 0 || remove(others.map((entry) => entry.key));
    },
    async clear() {
      const entries = await state.refresh();
      if (!entries) return false;
      if (entries.length === 0) return true;
      if (!ok(await settle(() => host.queue.clear()))) return false;
      record(shapeOf(entries), [], entries.length);
      return true;
    },
    async move(keys, before) {
      const found = await locate(keys);
      if (!found || found.hits.length === 0) return false;
      const moving = new Set(found.hits);
      const rest = found.entries.filter((entry) => !moving.has(entry));
      // 落点那一首自己也在挪的几首里（比如选中里含着队首，又点「移到队首」）：落到它后面第一首不挪的前面。
      const from = before === null ? -1 : found.entries.findIndex((entry) => entry.key === before);
      const landing = from < 0 ? undefined : found.entries.slice(from).find((e) => !moving.has(e));
      const anchor = landing ? rest.indexOf(landing) : -1;
      const at = anchor < 0 ? rest.length : anchor;
      return rearrange(found.entries, [...rest.slice(0, at), ...found.hits, ...rest.slice(at)]);
    },
    async shift(keys, delta) {
      const found = await locate(keys);
      if (!found || found.hits.length === 0) return false;
      const moving = new Set(found.hits);
      const next = [...found.entries];
      const swap = (from: number, to: number) => {
        const [left, right] = [next[from], next[to]];
        if (left && right) [next[from], next[to]] = [right, left];
      };
      if (delta < 0) {
        for (let at = 1; at < next.length; at++) {
          const here = next[at];
          const prior = next[at - 1];
          if (here && prior && moving.has(here) && !moving.has(prior)) swap(at, at - 1);
        }
      } else {
        for (let at = next.length - 2; at >= 0; at--) {
          const here = next[at];
          const after = next[at + 1];
          if (here && after && moving.has(here) && !moving.has(after)) swap(at, at + 1);
        }
      }
      return rearrange(found.entries, next);
    },
    undo: () => travel(true),
    redo: () => travel(false),
    dismissCleared() {
      if (store.get(undoAtom).cleared !== null) publish(null);
    },
  };

  // 命令一条接一条跑：每条都是「现读、对成下标、再改」几步，两条交错时后一条会按已经过时的下标改到别的行。
  let chain: Promise<unknown> = Promise.resolve();
  const serial =
    <A extends unknown[]>(run: (...args: A) => Promise<boolean>) =>
    (...args: A): Promise<boolean> => {
      const next = chain.then(() => run(...args));
      chain = next.catch(() => undefined);
      return next;
    };
  return {
    playNow: serial(direct.playNow),
    moveToTop: serial(direct.moveToTop),
    remove: serial(direct.remove),
    keepOnly: serial(direct.keepOnly),
    clear: serial(direct.clear),
    move: serial(direct.move),
    shift: serial(direct.shift),
    undo: serial(direct.undo),
    redo: serial(direct.redo),
    dismissCleared: direct.dismissCleared,
  };
}
