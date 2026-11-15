import { describe, expect, it } from 'vitest';
import {
  createExpanderRegistry,
  type ExpanderHandle,
} from '../../../src/settings/expanderMemory.ts';

function fakeCard(open: boolean) {
  const state = { open, sets: [] as boolean[] };
  const handle: ExpanderHandle = {
    isOpen: () => state.open,
    setOpen(next) {
      state.open = next;
      state.sets.push(next);
    },
  };
  return { state, handle };
}

describe('设置页展开卡的开合登记', () => {
  it('capture 写出每张已登记的卡此刻是开是合，包括合着的', () => {
    const registry = createExpanderRegistry();
    registry.register('appearance/窗口背景', fakeCard(false).handle);
    registry.register('shortcuts/快捷键', fakeCard(true).handle);
    expect(registry.capture()).toEqual({ 'appearance/窗口背景': false, 'shortcuts/快捷键': true });
  });

  it('restore 把开合交给已登记的卡；没提到的卡不动', () => {
    const registry = createExpanderRegistry();
    const background = fakeCard(false);
    const shortcuts = fakeCard(true);
    const credits = fakeCard(true);
    registry.register('appearance/窗口背景', background.handle);
    registry.register('shortcuts/快捷键', shortcuts.handle);
    registry.register('about/致谢', credits.handle);
    registry.restore({ 'appearance/窗口背景': true, 'shortcuts/快捷键': false });
    expect([background.state.open, shortcuts.state.open, credits.state.open]).toEqual([
      true,
      false,
      true,
    ]);
    expect(credits.state.sets).toEqual([]);
  });

  it('还没登记的卡等它登记时交一次，之后不再交', () => {
    const registry = createExpanderRegistry();
    registry.restore({ 'online/音质': true });
    const late = fakeCard(false);
    registry.register('online/音质', late.handle);
    expect(late.state.sets).toEqual([true]);
    const again = fakeCard(false);
    registry.register('online/音质', again.handle);
    expect(again.state.sets).toEqual([]);
  });

  it('切换分区卸载的卡：切回后按卸载前的开合状态还原，capture 的结果也包含它们', () => {
    const registry = createExpanderRegistry();
    const background = fakeCard(false);
    const off = registry.register('appearance/窗口背景', background.handle);
    background.state.open = true;
    off();
    expect(registry.capture()).toEqual({ 'appearance/窗口背景': true });

    const back = fakeCard(false);
    registry.register('appearance/窗口背景', back.handle);
    expect(back.state.sets).toEqual([true]);
    const next = fakeCard(false);
    registry.register('appearance/窗口背景', next.handle);
    expect(next.state.sets).toEqual([]);
  });

  it('再次 restore 时上一次还在等的作废', () => {
    const registry = createExpanderRegistry();
    registry.restore({ 'online/音质': true });
    registry.restore({});
    const late = fakeCard(false);
    registry.register('online/音质', late.handle);
    expect(late.state.sets).toEqual([]);
  });

  it('被替换的旧把手取消登记时，不删除新把手，也不改写新把手的开合', () => {
    const registry = createExpanderRegistry();
    const first = registry.register('general/托盘', fakeCard(true).handle);
    first();
    const stale = registry.register('general/托盘', fakeCard(true).handle);
    const fresh = fakeCard(false);
    registry.register('general/托盘', fresh.handle);
    stale();
    expect(registry.capture()).toEqual({ 'general/托盘': false });
  });
});
