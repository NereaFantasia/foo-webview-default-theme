import type { HistoryEntry } from '../nav/navHistory.ts';
import type { Place } from '../nav/places.ts';

/**
 * 中央区域的层：当前记录一层，切换时离场的旧记录一层，离场动画结束就移走。
 * 层的先后不随切换重排：挪动 DOM 节点会丢掉它里面的滚动位置。谁盖在上面由样式按 `exiting` 定。
 */
export interface PageLayer {
  readonly entry: HistoryEntry;
  /** 同页目录导航沿用 DOM，历史记录与快照仍各自独立。 */
  readonly identity?: HistoryEntry;
  readonly place: Place;
  readonly exiting: boolean;
}

/**
 * 历史换到一条记录时的层。还是当前这条，只换地点（离开时按页面此刻的主体改写过）；换了一条，
 * 原来的当前层改为离场，更早还在离场的直接移走。要去的正是离场中的那一层（离场没播完就又退回来），
 * 把它接回来当当前层，页面不重建。
 */
export function showEntry(
  layers: readonly PageLayer[],
  entry: HistoryEntry,
  place: Place,
): PageLayer[] {
  const current = layers.find((layer) => !layer.exiting);
  if (current?.place.id === 'folders' && place.id === 'folders' && current.entry !== entry) {
    return [{ entry, place, identity: current.identity ?? current.entry, exiting: false }];
  }
  if (current?.entry === entry) {
    return layers.map((layer) =>
      layer === current ? { ...layer, entry, place, exiting: false } : layer,
    );
  }
  const kept = layers.filter((layer) => layer.entry === entry || layer === current);
  const next = kept.map((layer) =>
    layer.entry === entry
      ? { ...layer, entry, place, exiting: false }
      : { ...layer, exiting: true },
  );
  if (!next.some((layer) => layer.entry === entry)) next.push({ entry, place, exiting: false });
  return next;
}

/** 离场动画播完，移走那一层；它已经被接回来当当前层时不动。 */
export function dropExiting(layers: readonly PageLayer[], entry: HistoryEntry): PageLayer[] {
  return layers.filter((layer) => !(layer.exiting && layer.entry === entry));
}
