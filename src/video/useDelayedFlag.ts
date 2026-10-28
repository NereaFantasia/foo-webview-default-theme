import { useEffect, useState } from 'react';

/** 延迟生效布尔标志：输入条件连续为 true 满 delay 毫秒后置为 true，条件解除时立即复位为 false */
export function useDelayedFlag(on: boolean, delay: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setHeld(true), delay);
    return () => {
      clearTimeout(timer);
      setHeld(false);
    };
  }, [on, delay]);
  return on && held;
}
