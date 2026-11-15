import { atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';

/** 按了上一首或下一首之后这么久内换的曲，按按键的方向算，毫秒 */
export const SKIP_INTENT_MS = 2000;

/** 按键留下的方向：连按几下同一个方向，`pending` 就是几，每换一首用掉一下 */
export interface SkipIntent {
  readonly direction: 'next' | 'previous';
  readonly at: number;
  readonly pending: number;
}

/** 换曲的过渡读它定方向；写它只经 `noteSkip`，由播放服务的 `next`、`previous` 统一记，各界面的键不自己记 */
export const skipIntentAtom = atom<SkipIntent | null>(null);

/** 这条记录还新鲜：还有没用掉的按键，也没过时限 */
export function isFresh(intent: SkipIntent | null, now: number): intent is SkipIntent {
  return intent !== null && intent.pending > 0 && now - intent.at <= SKIP_INTENT_MS;
}

/** 上一首、下一首发给宿主时记一下方向，随后到的换曲按它翻 */
export function noteSkip(
  store: Store,
  direction: SkipIntent['direction'],
  now: number = performance.now(),
): void {
  const last = store.get(skipIntentAtom);
  const pending = isFresh(last, now) && last.direction === direction ? last.pending + 1 : 1;
  store.set(skipIntentAtom, { direction, at: now, pending });
}
