import type { ColumnId } from './columns.ts';

// 拖动换列时的几何：指针落在哪一列前后、按新列序各列要挪多少。按下时量一次列头各格，拖动途中不再量。

/** 一列列头在按下那一刻的横向位置，视口坐标，CSS 像素。 */
export interface ColumnRect {
  readonly id: ColumnId;
  readonly left: number;
  readonly width: number;
}

/** 各列从原位置横向要挪的像素；没写的列不挪。 */
export type ColumnOffsets = Partial<Record<ColumnId, number>>;

export interface DropTarget {
  readonly id: ColumnId;
  /** 插在 `id` 后面；为假时插在前面。 */
  readonly after: boolean;
}

/** 松手的地方在不在列头那一条里；出了这一条松手不换列。 */
export function insideHeader(
  rects: readonly ColumnRect[],
  area: DOMRect,
  x: number,
  y: number,
): boolean {
  const movable = rects.filter((rect) => rect.id !== 'cover' && rect.width > 0);
  const first = movable[0];
  const last = movable.at(-1);
  if (!first || !last || y < area.top || y > area.bottom) return false;
  return x >= first.left && x <= last.left + last.width;
}

/**
 * 指针横坐标在 `x` 时，拖着的 `source` 落到哪：越过哪一列的中线就插到它前面，越过最后一列的中线就插到
 * 最后一列后面。落回原位时为 null。封面不参与换位。
 */
export function dropTarget(
  rects: readonly ColumnRect[],
  source: ColumnId,
  x: number,
): DropTarget | null {
  const movable = rects.filter((rect) => rect.id !== 'cover');
  const from = movable.findIndex((rect) => rect.id === source);
  if (from < 0) return null;
  const others = movable.filter((rect) => rect.id !== source);
  const first = others.findIndex((rect) => x < rect.left + rect.width / 2);
  const to = first < 0 ? others.length : first;
  if (to === from) return null;
  const before = others[first];
  if (before) return { id: before.id, after: false };
  const last = others.at(-1);
  return last ? { id: last.id, after: true } : null;
}

/**
 * 按 `order` 重新排一遍各列、宽度不变，答每列从原位置要挪多少。`gap` 是相邻两列之间的空隙。
 * `order` 里量不到的列（藏着的）跳过。
 */
export function columnOffsets(
  rects: readonly ColumnRect[],
  order: readonly ColumnId[],
  gap: number,
): ColumnOffsets {
  const first = rects[0];
  if (!first) return {};
  const byId = new Map(rects.map((rect) => [rect.id, rect]));
  const offsets: ColumnOffsets = {};
  let left = Math.min(...rects.map((rect) => rect.left));
  for (const id of order) {
    const rect = byId.get(id);
    if (!rect) continue;
    offsets[id] = left - rect.left;
    left += rect.width + gap;
  }
  return offsets;
}
