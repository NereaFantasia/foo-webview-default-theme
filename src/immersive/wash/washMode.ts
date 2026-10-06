import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';

/**
 * 图纸封面底色用哪一档：`flow` 是 WebGL 流动色场，`static` 是只画一次的静态色场。
 *
 * 流动档一旦判定不可用（建不出上下文、上下文丢失、帧率守门跳闸），本次运行里就不再尝试：
 * 换曲时重建上下文只会在同一台机器上再失败一次，还要白白卡一下。
 */
export type WashMode = 'flow' | 'static';

const unavailableAtom = atom(false);

/** 流动档在本次运行里已判不可用；只会由假转真，不回头。 */
export const flowUnavailableAtom: Atom<boolean> = atom((get) => get(unavailableAtom));

/** 流动档建不出上下文、上下文丢失或帧率守门跳闸时调。 */
export function markFlowUnavailable(store: Store): void {
  store.set(unavailableAtom, true);
}

/** `preferStatic` 是用户在设置页选了静态档。 */
export function washModeOf(
  reducedMotion: boolean,
  unavailable: boolean,
  preferStatic = false,
): WashMode {
  return preferStatic || reducedMotion || unavailable ? 'static' : 'flow';
}
