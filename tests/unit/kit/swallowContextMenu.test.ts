import { afterEach, describe, expect, it, vi } from 'vitest';
import { swallowNextContextMenu } from '../../../src/kit/swallowContextMenu.ts';

const menu = () => new Event('contextmenu', { cancelable: true });

/** 派发一次右键菜单事件，答它有没有被拦下。 */
function openMenu(target: EventTarget): boolean {
  const event = menu();
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('swallowNextContextMenu', () => {
  it('只吞接下来那一次，之后的右键菜单照常', () => {
    const target = new EventTarget();
    swallowNextContextMenu(target);
    expect(openMenu(target)).toBe(true);
    expect(openMenu(target)).toBe(false);
  });

  it('右键松开的 pointerup 之后，同一轮里的右键菜单照样吞掉；下一个任务起监听摘掉', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    swallowNextContextMenu(target);
    target.dispatchEvent(new Event('pointerup'));
    target.dispatchEvent(new Event('pointerup'));
    expect(openMenu(target)).toBe(true);

    swallowNextContextMenu(target);
    target.dispatchEvent(new Event('pointerup'));
    vi.runAllTimers();
    expect(openMenu(target)).toBe(false);
  });

  it('窗口失焦或调了返回的函数就摘掉', () => {
    const target = new EventTarget();
    swallowNextContextMenu(target);
    target.dispatchEvent(new Event('blur'));
    expect(openMenu(target)).toBe(false);

    const release = swallowNextContextMenu(target);
    release();
    expect(openMenu(target)).toBe(false);
  });
});
