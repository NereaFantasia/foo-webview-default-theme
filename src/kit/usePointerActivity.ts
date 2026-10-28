import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 追踪指针活跃状态的 Hook：触发活跃后在无操作空闲超时后自动复位为非活跃
 * 活跃状态主要用于控制浮层控件显隐；处于焦点内的控件应由调用方保持可见，Hook 本身不管理键盘焦点
 * @param delay 空闲复位延迟（毫秒，默认 3000 ms）
 */
export function usePointerActivity(delay = 3000) {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touch = useCallback(() => {
    clearTimeout(timer.current);
    setActive(true);
    timer.current = setTimeout(() => setActive(false), delay);
  }, [delay]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    active,
    touch,
  };
}
