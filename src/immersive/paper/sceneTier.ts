import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import type { PaperTier } from './paperTiers.ts';

const tierAtom = atom<PaperTier | null>(null);

/**
 * 图纸场景眼下落在哪一档，由场景在每次换档后报上来；场景没挂着时为 null。
 * 取数服务按它决定要不要只有某一档才画的数据（舞台上 BPM 格的逐拍拍点）。
 */
export const sceneTierAtom: Atom<PaperTier | null> = tierAtom;

export function reportSceneTier(store: Store, tier: PaperTier | null): void {
  store.set(tierAtom, tier);
}
