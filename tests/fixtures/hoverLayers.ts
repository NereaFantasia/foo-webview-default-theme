import type { Locator } from '@playwright/test';

/** 悬停时在指针下画了底色的一层 */
export interface PaintLayer {
  readonly tag: string;
  readonly role: string | null;
  readonly className: string;
  readonly background: string;
  readonly alpha: number;
}

/**
 * 把指针移到元素中心，等过渡与动画走完，列出从指针下最深的元素一路到该元素（含）之间、画了底色的各层。
 * 同一个控件的悬停底色只该画在一层上：根与槽各画一层时叠加的浓度会翻倍，也会露出内外两个框
 */
export async function hoverPaintLayers(target: Locator): Promise<PaintLayer[]> {
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  return target.evaluate(async (element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
    const alphaOf = (color: string): number => {
      if (color === 'transparent') return 0;
      const slash = /\/\s*([\d.]+%?)\s*\)/.exec(color);
      if (slash?.[1]) {
        const value = slash[1];
        return value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value);
      }
      const parts = /^rgba?\(([^)]*)\)$/.exec(color)?.[1]?.split(',');
      return parts && parts.length === 4 ? Number.parseFloat(parts[3] ?? '1') : 1;
    };
    const layers: PaintLayer[] = [];
    let node: Element | null = document.elementFromPoint(x, y);
    while (node && element.contains(node)) {
      const style = getComputedStyle(node);
      const alpha = alphaOf(style.backgroundColor);
      if (alpha > 0 || style.backgroundImage !== 'none') {
        layers.push({
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute('role'),
          className: String(node.getAttribute('class') ?? ''),
          background: `${style.backgroundColor} ${style.backgroundImage}`,
          alpha,
        });
      }
      if (node === element) break;
      node = node.parentElement;
    }
    return layers;
  });
}
