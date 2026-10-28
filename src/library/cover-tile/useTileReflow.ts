import { useLayoutEffect, useState, type RefObject } from 'react';
import { createTileReflow, type ReflowPlace } from './tileReflow.ts';

export interface TileReflowOptions {
  /** 图块宿主容器：图块（以及封面墙的节头与下拉）均为其直接子元素 */
  readonly rows: RefObject<HTMLElement | null>;
  /** 滚动容器引用；省略时视口回退为 document */
  readonly scroller?: RefObject<HTMLElement | null>;
  readonly places: ReadonlyMap<string, ReflowPlace>;
  /** 当前列数；未测得有效宽度时为 0 */
  readonly columns: number;
  readonly animate: boolean;
  /** 换列触发前滚动容器的 scrollTop（锚定前）；非换列状态为 null */
  readonly scrollBefore: number | null;
}

/**
 * 调度封面图块换列过渡动画
 *
 * 须在滚动锚定与布局高度修正生效后执行；根据容器最终 scrollTop 逆向推导相对视口位移
 */
export function useTileReflow(options: TileReflowOptions): void {
  const { rows, scroller, places, columns, animate, scrollBefore } = options;
  const [reflow] = useState(createTileReflow);
  useLayoutEffect(() => {
    reflow.commit(
      () => [...(rows.current?.children ?? [])].filter((child) => child instanceof HTMLElement),
      {
        columns,
        places,
        animate,
        viewport: () => {
          const element = scroller?.current;
          return {
            scrolled: scrollBefore === null || !element ? 0 : element.scrollTop - scrollBefore,
            reach: scroller ? (element?.clientHeight ?? 0) : document.documentElement.clientHeight,
          };
        },
      },
    );
  });
}
