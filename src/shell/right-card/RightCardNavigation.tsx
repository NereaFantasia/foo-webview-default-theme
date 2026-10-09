import { useAtomValueRawSync } from 'jotai/react';
import type { RefObject } from 'react';
import { BACK_BUTTON, BACK_KEYS, FORWARD_BUTTON, FORWARD_KEYS } from '../../nav/navCommands.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { useRightCard } from './rightCardContext.ts';

export function RightCardNavigation({ scope }: { readonly scope: RefObject<HTMLElement | null> }) {
  const { card } = useRightCard();
  const { form } = useAtomValueRawSync(card.view);
  const focused = () => {
    const element = document.activeElement;
    return (
      form !== 'none' &&
      (scope.current?.contains(element) === true ||
        (element instanceof HTMLElement && element.closest('[data-right-card-surface]') !== null))
    );
  };
  const pointed = () =>
    form !== 'none' &&
    (scope.current?.matches(':hover') === true ||
      document.querySelector('[data-right-card-surface]:hover') !== null);
  // 边界处仍接住输入，不能把右侧卡的后退交给主视图或浏览器。
  useCommand({
    id: 'rightCard.back',
    layer: 'widget',
    keys: BACK_KEYS,
    enabled: focused,
    run: () => {
      card.history.back();
    },
  });
  useCommand({
    id: 'rightCard.forward',
    layer: 'widget',
    keys: FORWARD_KEYS,
    enabled: focused,
    run: () => {
      card.history.forward();
    },
  });
  useCommand({
    id: 'rightCard.mouseBack',
    layer: 'widget',
    buttons: [BACK_BUTTON],
    enabled: pointed,
    run: () => {
      card.history.back();
    },
  });
  useCommand({
    id: 'rightCard.mouseForward',
    layer: 'widget',
    buttons: [FORWARD_BUTTON],
    enabled: pointed,
    run: () => {
      card.history.forward();
    },
  });
  return null;
}
