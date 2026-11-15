import { useLayoutEffect, useState } from 'react';
import type { ContextMenuViewport } from './contextMenuGeometry.ts';

/** 服务端渲染没有 `window`，视口取零。菜单关闭时不绘制内容，用不上 */
function readViewport(): ContextMenuViewport {
  if (typeof window === 'undefined') return { width: 0, height: 0, left: 0, top: 0 };
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
  };
}

export function useContextMenuViewport(): ContextMenuViewport {
  const [viewport, setViewport] = useState(readViewport);
  useLayoutEffect(() => {
    const update = () => setViewport(readViewport());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  return viewport;
}
