import { useLayoutEffect, useRef, useState } from 'react';

/**
 * 包装生命周期内引用恒定的回调函数，执行时自动转发至最新渲染传入的闭包
 * 用于传递给 memo 子组件以避免闭包变更引发多余重渲染；仅允许在事件处理中调用，渲染期调用将读取到上一轮提交的闭包
 */
export function useStableCallback<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  const [stable] = useState(
    () =>
      (...args: A): R =>
        latest.current(...args),
  );
  return stable;
}
