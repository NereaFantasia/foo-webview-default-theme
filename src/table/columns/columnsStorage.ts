import { storedRecord, recordOf, type PrefStorage } from '../../kit/localPref.ts';
import {
  COLUMN_IDS,
  COLUMNS,
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
 * `unit: 'px'` 区分独立像素宽度；旧比例宽度暂存在 `legacyWeights`，取得容器尺寸后换算并保存
 * `widths` 按 `COLUMNS` 的下标，`order` 是全部列的排列、封面打头。旧格式迁移到新键，原键保留
 * 读回先校验：列宽的项数不是哪一版、或有一项不是有限非负数时整份回缺省；`hidden` 不是数组时全都显示；列序不是
 * 那一版全部列的排列时回到缺省列序
 */

/** 页面新增可选列的版本；旧存档读回时仅将当时尚未提供的列收起 */
export interface IntroducedColumns {
  readonly widthCount: number;
  readonly columns: readonly ColumnId[];
}

export interface StoredColumns {
  readonly widths: ColumnWidths;
  readonly hidden: readonly ColumnId[];
  readonly order: readonly ColumnId[];
  readonly legacyWeights?: Readonly<Partial<Record<ColumnId, number>>>;
  /** 首次打开页面时用于判断旧格式是否尚未提供扩展字段，保存显隐后不再需要 */
  readonly legacyCount?: number;
}

function isWidthList(value: unknown): value is number[] {
  if (!Array.isArray(value) || !STORED_COUNTS.includes(value.length)) return false;
  const values: unknown[] = value;
  // 0 合法：封面列拖到 0 就是关掉
  return values.every((width) => typeof width === 'number' && Number.isFinite(width) && width >= 0);
}

/**
 * 定宽控件取缺省宽度，普通列不窄于 `MIN_WIDTH`；封面可以是 0
 */
function normalizeWidths(widths: ColumnWidths, defaults: ColumnWidths): ColumnWidths {
  return toWidths(
    COLUMNS.map((column, at) => {
      const width = widths[at] ?? 0;
      if (column.fixed) return defaults[at] ?? width;
      if (column.id === 'cover') return width;
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

/** 旧一版的列序补上它没有的列：每一列插在缺省列序里排在它前面、此刻已在列序里的最近那一列后面 */
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

function orderOf(value: unknown): readonly ColumnId[] {
  for (const count of STORED_COUNTS) {
    if (isPermutation(value, COLUMN_IDS.slice(0, count)))
      return withMissing(value, COLUMN_IDS.slice(count));
  }
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
 * 取 `fallback` 的，并记成藏着，存档时还没有这些列的用户，表上不该突然多出列来
 * 补齐的结果不写回，下一次存档自然落成全部列
 */
export function loadColumns(
  storage: PrefStorage | null,
  key: string,
  fallback: StoredColumns,
  introduced?: IntroducedColumns,
): StoredColumns {
  try {
    return parseColumns(storage?.getItem(key) ?? null, fallback, introduced);
  } catch {
    return fallback;
  }
}

export function parseColumns(
  raw: string | null,
  fallback: StoredColumns,
  introduced?: IntroducedColumns,
): StoredColumns {
  const saved = storedRecord(raw);
  if (saved.unit !== undefined && saved.unit !== 'px') return fallback;
  const widths = saved.widths;
  if (!isWidthList(widths)) return fallback;
  const legacyCount =
    typeof saved.legacyCount === 'number' && STORED_COUNTS.includes(saved.legacyCount)
      ? saved.legacyCount
      : saved.unit === 'px'
        ? undefined
        : widths.length;
  const missing = COLUMN_IDS.slice(widths.length);
  const legacyWeights: Partial<Record<ColumnId, number>> = { ...fallback.legacyWeights };
  const pending = recordOf(saved.legacyWeights);
  const full = COLUMNS.map((column, at) => {
    if (column.flexible) {
      const weight = saved.unit === 'px' ? pending[column.id] : widths[at];
      if (typeof weight === 'number' && Number.isFinite(weight) && weight >= 0) {
        legacyWeights[column.id] = weight;
        return fallback.widths[at] ?? 0;
      }
      if (at < widths.length) delete legacyWeights[column.id];
    }
    if (at < widths.length) return widths[at] ?? 0;
    return fallback.widths[at] ?? 0;
  });
  const hidden = hiddenOf(saved.hidden);
  if (introduced && (legacyCount ?? widths.length) < introduced.widthCount) {
    for (const id of introduced.columns) if (!hidden.includes(id)) hidden.push(id);
  }
  for (const id of missing) if (!hidden.includes(id)) hidden.push(id);
  return {
    widths: normalizeWidths(toWidths(full), fallback.widths),
    hidden,
    order: orderOf(saved.order),
    ...(Object.keys(legacyWeights).length ? { legacyWeights } : {}),
    ...(legacyCount !== undefined ? { legacyCount } : {}),
  };
}

export function formatColumns(columns: StoredColumns): string {
  return JSON.stringify({ unit: 'px', ...columns });
}

/** 写存档。存储满了或被禁用都不拦交互 */
export function saveColumns(
  storage: PrefStorage | null,
  key: string,
  columns: StoredColumns,
): void {
  try {
    storage?.setItem(key, formatColumns(columns));
  } catch {
    // 写不进去就只在页面这一次打开期间生效
  }
}
