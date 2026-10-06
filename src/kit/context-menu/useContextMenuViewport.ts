import { useLayoutEffect, useState } from 'react';
import type { ContextMenuViewport } from './contextMenuGeometry.ts';

function readViewport(): ContextMenuViewport {
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
