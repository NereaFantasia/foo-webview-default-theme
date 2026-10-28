import { useLayoutEffect, useRef, type RefObject } from 'react';
import { indicatorMotion } from '../motion/selectionIndicator.ts';

/** 提取带有 `data-nav-indicator` 属性并匹配指定选中键的导航指示条元素 */
function indicatorIn(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-nav-indicator="${CSS.escape(key)}"]`);
}

/**
 * 驱动导航选中指示条平滑位移的 Hook
 * 当选中项切换时，控制指示条从前一项平滑过渡至目标项（动画参数遵循 `selectionIndicator.ts`）
 * - 动画进行中再次切换时，立即中断旧动画并基于当前态衔接至新目标；
 * - 若任一端指示条节点不可用（如折叠、过滤剔除）或开启了减弱动效，则跳过补间直接定位
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
