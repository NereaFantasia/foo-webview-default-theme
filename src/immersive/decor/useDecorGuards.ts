import { useLayoutEffect, useState, type RefObject } from 'react';
import { toStageRect } from '../paper/paperStage.ts';
import type { PaperTier } from '../paper/paperTiers.ts';
import type { Rect } from './paperDecor.ts';

/** 内容层在场景里怎么放；三项只当重量的时机，换算用量到的实际缩放。 */
export interface DecorPlacement {
  /** 内容层左上角在场景里的位置，CSS 像素。 */
  readonly origin: { readonly x: number; readonly y: number };
  /** 内容层坐标到场景像素的比。 */
  readonly scale: number;
  /** 档位：换档时内容层整个换了一棵，护区元素也换了，要重量、重新盯。 */
  readonly tier: PaperTier;
}

const GUARD_SELECTOR = '[data-decor-guard]';

function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  return (
    a.length === b.length &&
    a.every((rect, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        rect.x === other.x &&
        rect.y === other.y &&
        rect.w === other.w &&
        rect.h === other.h
      );
    })
  );
}

/** 找不到内容层、或它还没排版（布局宽为 0）时答 `null`，护区留着上一次的。 */
function measureGuards(content: HTMLElement): Rect[] | null {
  if (content.offsetWidth <= 0) return null;
  const box = content.getBoundingClientRect();
  const scale = box.width / content.offsetWidth;
  if (!(scale > 0)) return null;
  const origin = { x: box.left, y: box.top };
  return Array.from(content.querySelectorAll<HTMLElement>(GUARD_SELECTOR), (element) => {
    const rect = element.getBoundingClientRect();
    const margin = Number(element.dataset.decorGuard) || 0;
    const inner = toStageRect(
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      origin,
      scale,
    );
    return {
      x: inner.x - margin,
      y: inner.y - margin,
      w: inner.w + 2 * margin,
      h: inner.h + 2 * margin,
    };
  });
}

/**
 * 生成式网格的护区：`root` 下内容层（标 `data-paper-content`）里标了 `data-decor-guard` 的元素盒子，按属性值外扩，
 * 给的是内容层坐标。量到的是屏幕盒子，减去内容层左上角再除以内容层的实际缩放（`toStageRect`），外扩按内容层像素加。
 *
 * 实际缩放取内容层量到的宽除以它的布局宽，不用 `placement.scale`：进出这一页的过渡给整层加了缩放，
 * 过渡中量到的盒子带着它，只除以舞台缩放的话护区会整体偏向内容层原点。
 *
 * 量的时机：挂载时、`placement` 变了（容器尺寸变了、换档）时在这次提交排好之后、浏览器上屏之前各量一次；护区元素
 * 自己的盒子变了（换曲后专辑名、艺术家名变长变短，字段补全晚到）也重量，由 ResizeObserver 盯着。
 * 量出的与上次相同时不换数组，网格不重建。
 */
export function useDecorGuards(
  root: RefObject<HTMLElement | null>,
  placement: DecorPlacement,
): Rect[] {
  const [guards, setGuards] = useState<Rect[]>([]);
  const {
    origin: { x, y },
    scale,
    tier,
  } = placement;
  useLayoutEffect(() => {
    const content = root.current?.querySelector<HTMLElement>('[data-paper-content]');
    if (!content) return;
    const measure = (): void => {
      const next = measureGuards(content);
      if (next) setGuards((current) => (sameRects(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of content.querySelectorAll(GUARD_SELECTOR)) observer.observe(element);
    return () => observer.disconnect();
  }, [root, x, y, scale, tier]);
  return guards;
}
