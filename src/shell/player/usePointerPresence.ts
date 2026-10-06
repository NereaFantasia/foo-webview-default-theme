import { useEffect, useRef, type RefObject } from 'react';

export interface PointerPresenceHandlers {
  enter(event: PointerEvent): void;
  leave(event: PointerEvent): void;
}

/**
 * 指针进出这一块：挂原生的 `pointerenter` / `pointerleave`，不用 React 的 `onPointerEnter` / `onPointerLeave`。
 * React 的那两个由 `pointerover` / `pointerout` 合成；指针底下的节点被换掉时（图标随状态换、线换成一句说明），
 * 浏览器把随后那次 `pointerout` 发给已经摘下的旧节点，冒不到 React 的根上，这一次离开就丢了，悬停展开的东西
 * 收不回去。原生的 `pointerleave` 沿祖先链逐个发，不受影响。处理函数每次渲染可以换，监听只挂一次。
 */
export function usePointerPresence(
  ref: RefObject<HTMLElement | null>,
  handlers: PointerPresenceHandlers,
): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const enter = (event: PointerEvent) => latest.current.enter(event);
    const leave = (event: PointerEvent) => latest.current.leave(event);
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    return () => {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
    };
  }, [ref]);
}
