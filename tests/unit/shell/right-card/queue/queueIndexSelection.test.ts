import { describe, expect, it } from 'vitest';
import { activateQueueIndex } from '../../../../../src/shell/right-card/queue/queueIndexSelection.ts';
import { emptySelection } from '../../../../../src/kit/keyedSelection.ts';

describe('虚拟队列的逻辑选择', () => {
  it('Shift 跨越未缓存页时包含整个区间，Ctrl 可取消单项', () => {
    const first = activateQueueIndex(emptySelection<number>(), 10, { ctrl: false, shift: false });
    const range = activateQueueIndex(first, 1500, { ctrl: false, shift: true });
    expect(range.selected.size).toBe(1491);
    expect(range.selected.has(600)).toBe(true);
    const toggled = activateQueueIndex(range, 600, { ctrl: true, shift: false });
    expect(toggled.selected.has(600)).toBe(false);
    expect(toggled.selected.has(1500)).toBe(true);
  });
  it('反向扩选仍按原锚点，Ctrl+Shift 保留区间外选择', () => {
    const first = activateQueueIndex(emptySelection<number>(), 100, { ctrl: false, shift: false });
    const second = activateQueueIndex(first, 200, { ctrl: true, shift: false });
    const range = activateQueueIndex(second, 190, { ctrl: true, shift: true });
    expect(range.selected.size).toBe(12);
    expect(range.selected.has(100)).toBe(true);
    expect(range.anchor?.key).toBe(200);
  });
});
