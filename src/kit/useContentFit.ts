import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * 铺开的内容放不放得下它所在的那一层（`host`，一层 `overflow: hidden` 的盒子）。放不下返回 false，调用方改用
 * 占地更小的形态；`host` 为 null 或 `enabled` 为假时恒为 true，不监听。`key` 是内容的身份：换了内容就从铺开
 * 的形态重新量
 *
 * 换成小形态之后，铺开形态的宽已经量不到了，所以放不下那一刻记下它要多宽，回头只看这一层有没有宽到那个数；
 * 不拿小形态的宽去比，两种形态的字宽差一点点时才不会来回切
 */
export function useContentFit(
  host: RefObject<HTMLElement | null> | null,
  enabled: boolean,
  key: string,
): boolean {
  const [fits, setFits] = useState(true);
  const needed = useRef(0);
  useLayoutEffect(() => {
    needed.current = 0;
    setFits(true);
  }, [host, enabled, key]);
  // 子组件的 layout effect 先于父元素挂上 ref，这里用挂载之后才跑的 effect 才拿得到 `host`
  useEffect(() => {
    const box = host?.current;
    if (!enabled || !box) return;
    // 两边的宽都取整，差 1 以内是舍入，不算放不下
    const measure = () => {
      if (fits) {
        if (box.scrollWidth > box.clientWidth + 1) {
          needed.current = box.scrollWidth;
          setFits(false);
        }
      } else if (box.clientWidth + 1 >= needed.current) setFits(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [host, enabled, fits]);
  return enabled ? fits : true;
}
