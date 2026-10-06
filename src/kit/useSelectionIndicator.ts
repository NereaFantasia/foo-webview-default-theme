import { useLayoutEffect, useRef, type RefObject } from 'react';
import { indicatorMotion } from '../motion/selectionIndicator.ts';

/** 每个导航项的竖条带 `data-nav-indicator`，值是该项的选中键；按它找出旧项与新项的竖条。 */
function indicatorIn(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-nav-indicator="${CSS.escape(key)}"]`);
}

/**
 * 选中项换了就让竖条从旧项移到新项（`selectionIndicator.ts`）。选中键为 null 表示一项都不亮。
 *
 * 动画中又选了别的，就停掉这一段、从刚才的目标重新起步；选中键没变不打断，等它做完。
 * 任一头找不到竖条（那一节收起了、被过滤掉了、列表删了）或减弱动效时直接到位，不播。
 */
export function useSelectionIndicator(
  root: RefObject<HTMLElement | null>,
  selected: string | null,
  reduced: boolean,
): void {
  const previous = useRef(selected);
  const running = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const from = previous.current;
    if (from === selected) return;
    previous.current = selected;
    for (const animation of running.current.splice(0)) animation.cancel();
    const container = root.current;
    if (reduced || !container || from === null || selected === null) return;
    const outgoing = indicatorIn(container, from);
    const incoming = indicatorIn(container, selected);
    if (!outgoing || !incoming) return;
    const move = {
      from: outgoing.getBoundingClientRect().top,
      to: incoming.getBoundingClientRect().top,
      height: incoming.offsetHeight,
    };
    for (const [element, isOutgoing] of [
      [outgoing, true],
      [incoming, false],
    ] as const) {
      for (const { keyframes, options } of indicatorMotion(move, isOutgoing)) {
        running.current.push(element.animate(keyframes, options));
      }
    }
  }, [root, selected, reduced]);

  useLayoutEffect(
    () => () => {
      for (const animation of running.current.splice(0)) animation.cancel();
    },
    [],
  );
}
