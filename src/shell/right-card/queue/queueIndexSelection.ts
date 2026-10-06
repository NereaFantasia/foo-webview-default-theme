import type { KeyedSelection, Modifiers } from '../../../kit/keyedSelection.ts';

/** 只记逻辑位置；滚动丢弃元数据不等于曲目被移除。来源代次变化时由调用方清空。 */
export function activateQueueIndex(
  selection: KeyedSelection<number>,
  index: number,
  modifiers: Modifiers,
): KeyedSelection<number> {
  const from = modifiers.shift ? selection.anchor?.key : undefined;
  if (from !== undefined) {
    const selected = new Set(modifiers.ctrl ? selection.selected : []);
    for (let at = Math.min(from, index); at <= Math.max(from, index); at++) selected.add(at);
    return { selected, anchor: selection.anchor };
  }
  const selected = new Set(modifiers.ctrl ? selection.selected : []);
  if (!selected.delete(index)) selected.add(index);
  return { selected, anchor: { key: index, at: index } };
}
