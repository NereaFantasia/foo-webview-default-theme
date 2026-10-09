import { createContext, useContext, type ReactNode } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import type { SnapshotHooks, SnapshotSlot } from '../../nav/historyStack.ts';
import { useHistorySnapshot } from '../../nav/usePageSnapshot.ts';
import type { RightCardServices } from './rightCardServices.ts';

/** 右侧卡里的组件经它拿服务；由 `RightCardDock` 提供，装配处把服务实例交给它。 */
export const RightCardContext = createContext<RightCardServices | null>(null);

export const RightCardBiographyContext = createContext<ReactNode>(null);
export const RightCardLyricsContext = createContext<ReactNode>(null);

export interface RightCardInformation {
  readonly content: ReactNode;
  readonly toolbar: ReactNode;
}

export const RightCardInformationContext = createContext<RightCardInformation | null>(null);

export function useRightCard(): RightCardServices {
  const services = useContext(RightCardContext);
  if (!services) throw new Error('useRightCard 只能在 RightCardDock 之内调用');
  return services;
}

export function useRightCardSnapshot<S extends object>(
  slot: SnapshotSlot<S>,
  hooks: SnapshotHooks<S>,
  ready = true,
): void {
  const { card } = useRightCard();
  const { entry } = useAtomValueRawSync(card.navigation);
  useHistorySnapshot(card.history, entry, slot, hooks, ready);
}

/** 开合右侧卡的键身上带这个属性：按在它上面不算浮层「外面」，免得按下时关掉、松开的单击又打开。 */
export const RIGHT_CARD_KEY_ATTR = 'data-right-card-key';
