import type { PlacedTile } from './albumGridLayout.ts';

/**
 * 悬停快捷按键双缓冲槽位
 * 一个槽跟随当前悬停图块，另一个槽保留在上一图块用于淡出过渡，避免切换时位置跳变或背景色彩闪烁
 */
export interface KeySlots {
  readonly tiles: readonly [PlacedTile | undefined, PlacedTile | undefined];
  /** 最近一次激活悬停的槽位索引 (0 | 1) */
  readonly current: 0 | 1;
  /** 指针是否悬停在图块上：为真时当前槽可见，另一槽执行淡出 */
  readonly visible: boolean;
}

/** 初始空白槽位状态，初次悬停将落入槽位 0 */
export const NO_KEY_SLOTS: KeySlots = { tiles: [undefined, undefined], current: 1, visible: false };

function sameSpot(a: PlacedTile, b: PlacedTile): boolean {
  return a.key === b.key && a.index === b.index && a.x === b.x && a.y === b.y;
}

/**
 * 根据当前悬停图块计算下一帧槽位状态
 * 若目标图块已处于某一槽位（含淡出中）则沿用，否则抢占另一空闲槽位；无变化时返回原引用以跳过重绘
 */
export function nextKeySlots(slots: KeySlots, hovered: PlacedTile | undefined): KeySlots {
  if (!hovered) return slots.visible ? { ...slots, visible: false } : slots;
  const held = slots.tiles.findIndex((tile) => tile?.key === hovered.key);
  const current = held < 0 ? (slots.current === 0 ? 1 : 0) : held === 0 ? 0 : 1;
  const old = slots.tiles[current];
  if (slots.visible && slots.current === current && old && sameSpot(old, hovered)) return slots;
  return {
    tiles: [current === 0 ? hovered : slots.tiles[0], current === 1 ? hovered : slots.tiles[1]],
    current,
    visible: true,
  };
}
