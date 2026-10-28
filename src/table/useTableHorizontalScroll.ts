import { useLayoutEffect, type RefObject } from 'react';

/** 列头与虚拟行带共用原生横向滚动位置；纵向仍由各页面原有的滚动容器负责 */
export function useTableHorizontalScroll(
  root: RefObject<HTMLElement | null>,
  horizontal: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const table = root.current;
    const bar = horizontal.current;
    if (!table || !bar) return;
    const follow = () => {
      table.style.setProperty('--table-scroll-left', `${bar.scrollLeft}px`);
      bar.dataset['overflow'] = String(bar.scrollWidth > bar.clientWidth);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta) return;
      const before = bar.scrollLeft;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bar.clientWidth : 1;
      bar.scrollLeft += delta * scale;
      if (bar.scrollLeft !== before) {
        event.preventDefault();
        follow();
      }
    };
    const focus = (event: FocusEvent) => {
      const target = event.target;
      const cell =
        target instanceof Element ? target.closest<HTMLElement>('[data-column-id]') : null;
      if (!cell) return;
      const bounds =
        table.firstElementChild?.getBoundingClientRect() ?? bar.getBoundingClientRect();
      const box = cell.getBoundingClientRect();
      if (box.left < bounds.left) bar.scrollLeft += box.left - bounds.left;
      else if (box.right > bounds.right)
        bar.scrollLeft += Math.min(box.right - bounds.right, box.left - bounds.left);
      follow();
    };
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        follow();
      });
    });
    observer.observe(bar);
    if (bar.firstElementChild) observer.observe(bar.firstElementChild);
    bar.addEventListener('scroll', follow, { passive: true });
    table.addEventListener('wheel', wheel, { passive: false });
    table.addEventListener('focusin', focus);
    follow();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      bar.removeEventListener('scroll', follow);
      table.removeEventListener('wheel', wheel);
      table.removeEventListener('focusin', focus);
    };
  }, [root, horizontal]);

  useLayoutEffect(() => {
    const bar = horizontal.current;
    if (bar) root.current?.style.setProperty('--table-scroll-left', `${bar.scrollLeft}px`);
  });
}
