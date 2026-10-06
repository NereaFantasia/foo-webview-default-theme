import { useLayoutEffect, useState, type RefObject } from 'react';
import { createWallReflow, type ReflowPlace } from './wallReflow.ts';

export interface WallReflowOptions {
  /** 行层：图块、节头与下拉都是它的直接子元素。 */
  readonly rows: RefObject<HTMLElement | null>;
  readonly scroller: RefObject<HTMLElement | null>;
  readonly places: ReadonlyMap<string, ReflowPlace>;
  /** 此刻的列数；还没量出宽度时是 0。 */
  readonly columns: number;
  readonly animate: boolean;
  /** 换列这次渲染时滚动容器的 scrollTop（锚定之前）；没换列是 null。 */
  readonly scrollBefore: number | null;
}

/**
 * 封面墙换列时让图块、节头与下拉从旧位置滑到新位置（`wallReflow.ts`）。排在锚定滚动的那一步之后：
 * 位移按锚定、夹取之后真正的 scrollTop 算。
 */
export function useWallReflow(options: WallReflowOptions): void {
  const { rows, scroller, places, columns, animate, scrollBefore } = options;
  const [reflow] = useState(createWallReflow);
  useLayoutEffect(() => {
    reflow.commit(
      () => [...(rows.current?.children ?? [])].filter((child) => child instanceof HTMLElement),
      {
        columns,
        places,
        animate,
        viewport: () => {
          const element = scroller.current;
          return {
            scrolled: scrollBefore === null || !element ? 0 : element.scrollTop - scrollBefore,
            reach: element?.clientHeight ?? 0,
          };
        },
      },
    );
  });
}
