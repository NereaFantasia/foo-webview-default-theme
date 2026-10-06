import { useEffect, useRef, useState } from 'react';

/** 活动只影响控件显隐；焦点内的控件由调用方保持可见，不改变键盘焦点。 */
export function usePointerActivity(delay = 3000) {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    active,
    touch() {
      clearTimeout(timer.current);
      setActive(true);
      timer.current = setTimeout(() => setActive(false), delay);
    },
  };
}
