import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import type { QueueEntry } from './queueState.ts';

export interface QueueTransitionFace {
  queue: Pick<typeof fb.queue, 'remove' | 'setContents' | 'insertNext'>;
}

/** 一份队列的样子：按播放顺序的句柄。撤销与重做记的就是改动前后各一份。 */
export type QueueShape = readonly string[];

export function shapeOf(entries: readonly QueueEntry[]): string[] {
  return entries.map((entry) => entry.track.handle);
}

function sameShape(left: QueueShape, right: QueueShape): boolean {
  return left.length === right.length && left.every((handle, index) => handle === right[index]);
}

/**
 * 记下的那份（`from`）之后，核心可能又从队首取走了几首。此刻的队列是它去掉开头若干首时，答取走了几首；
 * 对不上（队列在别处被改过）答 null。
 */
export function consumedSince(from: QueueShape, now: QueueShape): number | null {
  for (let taken = 0; taken <= from.length; taken++) {
    if (sameShape(from.slice(taken), now)) return taken;
  }
  return null;
}

/** 从 `shape` 里各去掉一次 `gone` 里的句柄：期间已经播掉的不放回。 */
export function withoutPlayed(shape: QueueShape, gone: QueueShape): string[] {
  const left = new Map<string, number>();
  for (const handle of gone) left.set(handle, (left.get(handle) ?? 0) + 1);
  return shape.filter((handle) => {
    const count = left.get(handle) ?? 0;
    if (count === 0) return true;
    left.set(handle, count - 1);
    return false;
  });
}

/** 改成 `target` 要做的三步：先移除哪些下标，留下的按什么顺序排，再在哪些位置补回哪些路径。 */
export interface TransitionPlan {
  readonly remove: readonly number[];
  /** 留下的条目在移除之后的队列里的下标，按目标顺序；顺序没变时为 null。 */
  readonly order: readonly number[] | null;
  /** 按位置从小到大：在目标序列的 `position` 处补回连续的一段。 */
  readonly inserts: readonly { readonly position: number; readonly paths: readonly string[] }[];
}

/**
 * 算出从此刻的队列改成 `target` 的三步。同一首出现几次按次数配对：此刻多出来的移除，缺的补回。补回走
 * `insertNext` 的路径形态，补回的条目不带列表位置；队列里本就有一份的同一首会被宿主挪过来而不是再排一份，
 * 所以同一首排两次的队列撤销不全，这样的队列只会来自别处。
 */
export function planTransition(now: QueueShape, target: QueueShape): TransitionPlan {
  const wanted = new Map<string, number>();
  for (const handle of target) wanted.set(handle, (wanted.get(handle) ?? 0) + 1);
  const remove: number[] = [];
  const kept: string[] = [];
  now.forEach((handle, index) => {
    const count = wanted.get(handle) ?? 0;
    if (count === 0) {
      remove.push(index);
      return;
    }
    wanted.set(handle, count - 1);
    kept.push(handle);
  });
  // 留下的按目标里的先后排；目标里多出来的（`wanted` 里还剩的次数）是要补回的。
  const slots = new Map<string, number[]>();
  kept.forEach((handle, index) => slots.set(handle, [...(slots.get(handle) ?? []), index]));
  const order: number[] = [];
  const inserts: { position: number; paths: string[] }[] = [];
  target.forEach((handle, position) => {
    const slot = slots.get(handle)?.shift();
    if (slot !== undefined) {
      order.push(slot);
      return;
    }
    const last = inserts.at(-1);
    if (last && last.position + last.paths.length === position) last.paths.push(handle);
    else inserts.push({ position, paths: [handle] });
  });
  const moved = order.some((slot, index) => slot !== index);
  return { remove, order: moved ? order : null, inserts };
}

/** 照计划改队列。三步不是原子的，中途失败即停、答 false，已经做了的不回滚。 */
export async function applyTransition(
  host: QueueTransitionFace,
  plan: TransitionPlan,
): Promise<boolean> {
  const ok = (answer: { success?: unknown } | null) => answer?.success === true;
  if (plan.remove.length > 0 && !ok(await settle(() => host.queue.remove([...plan.remove])))) {
    return false;
  }
  const order = plan.order;
  if (order) {
    const items = order.map((queueIndex) => ({ queueIndex }));
    if (!ok(await settle(() => host.queue.setContents(items)))) return false;
  }
  for (const { position, paths } of plan.inserts) {
    if (!ok(await settle(() => host.queue.insertNext([...paths], position)))) return false;
  }
  return true;
}
