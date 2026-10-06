import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDragHover,
  DRAG_HOVER_CLOSE_MS,
  DRAG_HOVER_OPEN_MS,
} from '../../../../src/shell/sidebar/dragHover.ts';

afterEach(() => {
  vi.useRealTimers();
});

function setup(initiallyOpen = false) {
  vi.useFakeTimers();
  let open = initiallyOpen;
  const log: string[] = [];
  const hover = createDragHover({
    isOpen: () => open,
    open: () => {
      open = true;
      log.push('open');
    },
    close: () => {
      open = false;
      log.push('close');
    },
  });
  return { hover, log, isOpen: () => open };
}

describe('createDragHover', () => {
  it('停在图标上 500 ms 才弹出，不到就离开不弹', () => {
    const { hover, log } = setup();
    hover.over('anchor');
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS - 1);
    hover.over(null);
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS);
    expect(log).toEqual([]);
    hover.over('anchor');
    // 停着不动时浏览器照样隔一会儿报一次 dragover，不从头计时。
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS / 2);
    hover.over('anchor');
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS / 2);
    expect(log).toEqual(['open']);
  });

  it('拖动弹出的：离开图标与浮层 300 ms 收起，回到浮层里就不收', () => {
    const { hover, log } = setup();
    hover.over('anchor');
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS);
    hover.over('panel');
    hover.over(null);
    vi.advanceTimersByTime(DRAG_HOVER_CLOSE_MS - 1);
    hover.over('panel');
    vi.advanceTimersByTime(DRAG_HOVER_CLOSE_MS);
    expect(log).toEqual(['open']);
    hover.over(null);
    hover.over(null);
    vi.advanceTimersByTime(DRAG_HOVER_CLOSE_MS);
    expect(log).toEqual(['open', 'close']);
  });

  it('落下立即收起拖动弹出的；用户点开的不因拖放而收', () => {
    const dragged = setup();
    dragged.hover.over('anchor');
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS);
    dragged.hover.end();
    expect(dragged.log).toEqual(['open', 'close']);

    const clicked = setup(true);
    clicked.hover.over(null);
    vi.advanceTimersByTime(DRAG_HOVER_CLOSE_MS);
    clicked.hover.end();
    expect(clicked.log).toEqual([]);
    expect(clicked.isOpen()).toBe(true);
  });

  it('别的途径开合过（点图标、点外面）：排着的开合作废，不再当作拖动弹出的', () => {
    const { hover, log } = setup();
    hover.over('anchor');
    hover.reset();
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS);
    expect(log).toEqual([]);
    hover.over('anchor');
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS);
    hover.over(null);
    hover.reset();
    vi.advanceTimersByTime(DRAG_HOVER_CLOSE_MS);
    hover.end();
    expect(log).toEqual(['open']);
  });

  it('释放后排着的开合不再来', () => {
    const { hover, log } = setup();
    hover.over('anchor');
    hover.dispose();
    vi.advanceTimersByTime(DRAG_HOVER_OPEN_MS);
    expect(log).toEqual([]);
  });
});
