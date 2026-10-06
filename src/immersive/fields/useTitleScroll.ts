import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useState, type RefObject } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { createFrameScheduler } from '../frame/frameScheduler.ts';
import { fittedFontSize, titleScrollAt, wipeMask } from './titleScroll.ts';

export interface TitleScrollOptions {
  /** 字号档位（px）：从 `max` 起每次降 `step`，最低 `min`。 */
  readonly font: { readonly max: number; readonly min: number; readonly step: number };
  /** 滚动速度（px/s）与擦除软边（px）；缺省按版心档。 */
  readonly speed?: number;
  readonly softness?: number;
}

/**
 * 长标题的适配：字号从 `font.max` 起按 `fittedFontSize` 逐档降，写在 `box` 的行内样式上；降到 `font.min`
 * 仍放不下就按 `titleScroll.ts` 的节奏循环滚动与擦除，减弱动效下不滚、留省略号。
 *
 * `box` 是定宽、`overflow: hidden` 的标题容器，`text` 是里面装文字的元素：滚动时移 `text`、擦除时给 `box`
 * 设 `mask-image`，两者都直接写行内样式，不经 React 状态。`rolling` 为真期间调用方要把 `text` 设成
 * `inline-block`（行内元素上 transform 不生效）并关掉省略号；不滚时 `text` 保持行内，省略号照常。
 *
 * 量的是提交后的排版。换标题、切换减弱动效时从头量、从头计时；`box` 的宽变了（例如从不显示到显示）也重量，
 * 只变高（换字号）不重量。舞台整幅缩放用的是 transform，不改 `clientWidth`，不会引起重量。
 */
export function useTitleScroll(
  box: RefObject<HTMLElement | null>,
  text: RefObject<HTMLElement | null>,
  title: string,
  options: TitleScrollOptions,
): { rolling: boolean } {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [rolling, setRolling] = useState(false);
  const { speed, softness } = options;
  const { max, min, step } = options.font;

  useLayoutEffect(() => {
    const element = box.current;
    const inner = text.current;
    if (!element || !inner) return;
    let overflow = 0;
    let startedAt = 0;
    // 上一次量的时候的盒宽；只有它变了，尺寸回调才重量。
    let width = -1;

    const apply = (offset: number, mask: string): void => {
      inner.style.transform = offset ? `translateX(${-offset}px)` : '';
      element.style.maskImage = mask;
    };

    const frames = createFrameScheduler((now) => {
      const frame = titleScrollAt((now - startedAt) / 1000, overflow, speed);
      apply(frame.offset, wipeMask(frame.wipe, element.clientWidth, softness));
      frames.schedule();
    });

    // 读 scrollWidth 会强制同步排版，改完字号接着量就是新字号下的宽。偏移先归零：移过的文字也算进溢出。
    const fit = (): void => {
      frames.cancel();
      apply(0, '');
      element.style.fontSize = `${max}px`;
      width = element.clientWidth;
      overflow = 0;
      if (element.scrollWidth > width) {
        const size = fittedFontSize(width, element.scrollWidth, { max, min, step });
        element.style.fontSize = `${size}px`;
        overflow = element.scrollWidth - element.clientWidth;
      }
      const roll = overflow > 0 && !reduced;
      setRolling(roll);
      if (!roll) return;
      startedAt = performance.now();
      frames.schedule();
    };

    fit();
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) fit();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      frames.cancel();
      apply(0, '');
    };
  }, [box, text, title, reduced, max, min, step, speed, softness]);

  return { rolling };
}
