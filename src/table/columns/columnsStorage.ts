import { storedRecord, type PrefStorage } from '../../kit/localPref.ts';
import {
  COLUMN_IDS,
  COLUMNS,
  columnIndex,
  DEFAULT_ORDER,
  isColumnId,
  MIN_WIDTH,
  REQUIRED_COLUMN,
  STORED_COUNTS,
  toWidths,
  type ColumnId,
  type ColumnWidths,
} from './columns.ts';

/**
 * 列宽、显隐与列序的存档，存 localStorage，一张表一个键。形状是
 * `{ widths: number[], hidden: ColumnId[], order: ColumnId[] }`：`widths` 按 `COLUMNS` 的下标，`order` 是全部列的
 * 排列、封面打头。列只往末尾加，存档不换键，按 `widths` 的项数认是哪一版（`STORED_COUNTS`），缺的列读时原地补齐。
 * 读回先校验：列宽的项数不是哪一版、或有一项不是有限非负数时整份回缺省；`hidden` 不是数组时全都显示；列序不是
 * 那一版全部列的排列时回到缺省列序。
 */

export interface StoredColumns {
  readonly widths: ColumnWidths;
  readonly hidden: readonly ColumnId[];
  readonly order: readonly ColumnId[];
}

function isWidthList(value: unknown): value is number[] {
  if (!Array.isArray(value) || !STORED_COUNTS.includes(value.length)) return false;
  const values: unknown[] = value;
  // 0 合法：封面列拖到 0 就是关掉。
  return values.every((width) => typeof width === 'number' && Number.isFinite(width) && width >= 0);
}

/**
 * 读回的列宽再按列夹一遍：定宽列（状态、等级）按内容定死，一律取缺省；存像素的列不窄于 `MIN_WIDTH`，
 * 封面列除外（它可以是 0）。fr 列存的是权重，不夹。
 */
function normalizeWidths(widths: ColumnWidths, defaults: ColumnWidths): ColumnWidths {
  return toWidths(
    COLUMNS.map((column, at) => {
      const width = widths[at] ?? 0;
      if (column.fixed) return defaults[at] ?? width;
      if (column.flexible || column.id === 'cover') return width;
      return Math.max(width, MIN_WIDTH);
    }),
  );
}

function isPermutation(value: unknown, expected: readonly ColumnId[]): value is ColumnId[] {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const values: unknown[] = value;
  return (
    values[0] === 'cover' &&
    new Set(values).size === expected.length &&
    values.every((id) => isColumnId(id) && expected.includes(id))
  );
}

/** 旧一版的列序补上它没有的列：每一列插在缺省列序里排在它前面、此刻已在列序里的最近那一列后面。 */
function withMissing(order: readonly ColumnId[], missing: readonly ColumnId[]): ColumnId[] {
  const next = [...order];
  for (const [at, id] of DEFAULT_ORDER.entries()) {
    if (!missing.includes(id)) continue;
    const before = DEFAULT_ORDER.slice(0, at)
      .reverse()
      .find((other) => next.includes(other));
    next.splice(before === undefined ? next.length : next.indexOf(before) + 1, 0, id);
  }
  return next;
}

function orderOf(value: unknown, missing: readonly ColumnId[]): readonly ColumnId[] {
  if (isPermutation(value, DEFAULT_ORDER)) return value;
  const known = DEFAULT_ORDER.filter((id) => !missing.includes(id));
  if (missing.length > 0 && isPermutation(value, known)) return withMissing(value, missing);
  return DEFAULT_ORDER;
}

function hiddenOf(value: unknown): ColumnId[] {
  if (!Array.isArray(value)) return [];
  const values: unknown[] = value;
  const kept = values.filter((id): id is ColumnId => isColumnId(id) && id !== REQUIRED_COLUMN);
  return [...new Set(kept)];
}

/**
 * 读一张表的存档。没有存档、存储读不了、JSON 坏了或列宽不对都给 `fallback`。旧一版的存档补上它没有的列：宽度
 * 取 `fallback` 的（专辑列取艺术家列的权重），并记成藏着，存档时还没有这些列的用户，表上不该突然多出列来。
 * 补齐的结果不写回，下一次存档自然落成全部列。
 */
export function loadColumns(
  storage: PrefStorage | null,
  key: string,
  fallback: StoredColumns,
): StoredColumns {
  let saved: Readonly<Record<string, unknown>>;
  try {
    saved = storedRecord(storage?.getItem(key) ?? null);
  } catch {
    return fallback;
  }
  const widths = saved.widths;
  if (!isWidthList(widths)) return fallback;
  const missing = COLUMN_IDS.slice(widths.length);
  const full = COLUMNS.map((column, at) => {
    if (at < widths.length) return widths[at] ?? 0;
    if (column.id === 'album') return widths[columnIndex('artist')] ?? 0;
    return fallback.widths[at] ?? 0;
  });
  const hidden = hiddenOf(saved.hidden);
  for (const id of missing) if (!hidden.includes(id)) hidden.push(id);
  return {
    widths: normalizeWidths(toWidths(full), fallback.widths),
    hidden,
    order: orderOf(saved.order, missing),
  };
}

/** 写存档。存储满了或被禁用都不拦交互。 */
export function saveColumns(
  storage: PrefStorage | null,
  key: string,
  columns: StoredColumns,
): void {
  try {
    storage?.setItem(
      key,
      JSON.stringify({ widths: columns.widths, hidden: columns.hidden, order: columns.order }),
    );
  } catch {
    // 写不进去就只在页面这一次打开期间生效。
  }
}
