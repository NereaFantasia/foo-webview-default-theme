import { defineLocalPref, storedRecord, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';

export const FLOW_SPEED_KEY = 'default-theme.background-flow.v1';
/** 单位是百分数，100 是色场原本的速度；深浅两档共用一个值 */
export const FLOW_SPEED_LIMITS = { min: 25, max: 200, step: 5, default: 100 } as const;

function percent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(FLOW_SPEED_LIMITS.min, Math.min(FLOW_SPEED_LIMITS.max, value)))
    : FLOW_SPEED_LIMITS.default;
}

/** 窗口背景选「流动色场」时的流动速度；与深浅数值各自的存档分开，不并入「恢复当前模式默认值」 */
const pref = defineLocalPref<number>({
  key: FLOW_SPEED_KEY,
  fallback: FLOW_SPEED_LIMITS.default,
  parse: (raw) => percent(storedRecord(raw).speed),
  format: (value) => JSON.stringify({ speed: value }),
});

export const flowSpeedAtom = pref.atom;

export function loadFlowSpeed(store: Store, storage?: PrefStorage | null): void {
  pref.load(store, storage);
}

export function chooseFlowSpeed(store: Store, value: number, storage?: PrefStorage | null): void {
  if (!Number.isFinite(value)) return;
  pref.set(store, percent(value), storage);
}
