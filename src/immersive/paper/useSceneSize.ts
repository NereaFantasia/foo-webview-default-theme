import { useLayoutEffect, useState, type RefObject } from 'react';

export interface SceneSize {
  readonly width: number;
  readonly height: number;
}

/** 还没量到时按的容器尺寸：窗口的常见大小，落在 full 档。 */
const INITIAL_SIZE: SceneSize = { width: 1280, height: 800 };

/** 场景根元素的内容盒尺寸（CSS 像素），跟着 ResizeObserver 走；只在宽或高真的变了时换新值。 */
export function useSceneSize(root: RefObject<HTMLElement | null>): SceneSize {
  const [size, setSize] = useState(INITIAL_SIZE);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const update = (width: number, height: number): void => {
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    update(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) update(box.width, box.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  return size;
}
