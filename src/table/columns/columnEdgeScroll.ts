/** 列头拖动靠近视口边缘时的感应宽度，CSS 像素；速度上限为每秒 600 像素 */
const EDGE = 28;
const SPEED = 600;

/** 改宽与换列共用边缘滚动，指针离开列头上下范围时停下，结束手势后释放动画帧 */
export function startColumnEdgeScroll(
  root: HTMLElement | null,
  header: HTMLElement,
  changed: (delta: number) => void,
) {
  const bar = root?.querySelector<HTMLElement>('[data-table-horizontal]');
  let frame: number | undefined;
  let x = 0;
  let y = 0;
  let previous = 0;
  let disposed = false;
  function tick(time: number) {
    frame = undefined;
    if (disposed || !bar || !root?.isConnected) return;
    const bounds = header.parentElement?.getBoundingClientRect() ?? bar.getBoundingClientRect();
    const row = header.getBoundingClientRect();
    if (y < row.top || y > row.bottom) return;
    const direction =
      x < bounds.left + EDGE
        ? -Math.min(1, (bounds.left + EDGE - x) / EDGE)
        : x > bounds.right - EDGE
          ? Math.min(1, (x - bounds.right + EDGE) / EDGE)
          : 0;
    if (!direction) return;
    const elapsed = Math.min(32, previous ? time - previous : 16);
    previous = time;
    const before = bar.scrollLeft;
    bar.scrollLeft += (direction * SPEED * elapsed) / 1000;
    if (bar.scrollLeft !== before) {
      root.style.setProperty('--table-scroll-left', `${bar.scrollLeft}px`);
      changed(bar.scrollLeft - before);
    }
    frame = requestAnimationFrame(tick);
  }
  return {
    offset: () => bar?.scrollLeft ?? 0,
    update(clientX: number, clientY: number) {
      x = clientX;
      y = clientY;
      if (!disposed && frame === undefined) {
        previous = 0;
        frame = requestAnimationFrame(tick);
      }
    },
    dispose() {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    },
  };
}
