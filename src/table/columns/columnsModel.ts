import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';
import { browserStorage, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import {
  DEFAULT_ORDER,
  DEFAULT_WIDTHS,
  insertColumn,
  isColumnId,
  REQUIRED_COLUMN,
  MIN_WIDTH,
  widthOf,
  withWidth,
  type ColumnId,
  type ColumnWidths,
} from './columns.ts';
import {
  columnsLayout,
  canResizeColumn,
  type ColumnsLayout,
  type ColumnsState,
} from './columnsLayout.ts';
import {
  loadColumns,
  saveColumns,
  type StoredColumns,
  type IntroducedColumns,
} from './columnsStorage.ts';

/** 一次分隔条拖动。`update` 收的是从按下起算的总位移，不累加 */
export interface ColumnResize {
  update(dx: number): void;
  /** 松手：落盘 */
  commit(): void;
  /** 取消：回到按下时的列宽，不落盘 */
  cancel(): void;
}

export interface ColumnsOptions {
  /** localStorage 的键，一张表一个 */
  readonly key: string;
  /** 可信存储不可用时仍可读取旧值供本次显示；正常迁移由启动装配完成 */
  readonly previousKey?: string;
  /** 这张表有哪几列；列头菜单只列这几列，存档里别的列原样留着 */
  readonly offered: readonly ColumnId[];
  /** 没有存档时藏哪几列 */
  readonly hidden?: readonly ColumnId[];
  readonly introduced?: IntroducedColumns;
  /** 没有存档时与缺省不同的列宽 */
  readonly widths?: Partial<Record<ColumnId, number>>;
  /** 缺省是页面的 localStorage */
  readonly storage?: PrefStorage | null;
}

export interface ColumnsModel {
  readonly offered: readonly ColumnId[];
  readonly state: Atom<ColumnsState>;
  readonly layout: Atom<ColumnsLayout>;
  /** 容器宽度用于换算旧比例列，以及限制封面宽度 */
  setContainerWidth(width: number): void;
  /**
   * 按下 `left` 右缘的分隔条。`measured` 是按下这一刻各列的实测像素宽。没有分隔条的列答 null
   * 位移只作用于当前列，其他列保持各自宽度
   */
  beginResize(left: ColumnId, measured: ReadonlyMap<ColumnId, number>): ColumnResize | null;
  setHidden(id: ColumnId, hidden: boolean): void;
  moveColumn(source: ColumnId, target: ColumnId, after: boolean): void;
  /**
   * 挪到相邻的已显示列另一侧，到头了答 false；勾掉的列相对顺序不动
   */
  moveAdjacent(source: ColumnId, direction: -1 | 1): boolean;
  /** 列宽、显隐与列序都回到建模型时的缺省，并落盘 */
  reset(): void;
}

/** 旧比例列在首个有效容器尺寸下换成像素；最小宽度与旧栅格一致，隐藏列沿用同一比例 */
function resolveLegacyWidths(
  state: ColumnsState,
  layout: ColumnsLayout,
  measured: ReadonlyMap<ColumnId, number>,
): ColumnWidths {
  const weights = state.legacyWeights ?? {};
  const flexible = layout.cells.filter((id) => weights[id] !== undefined);
  let pixels = Math.max(
    0,
    state.containerWidth -
      layout.coverWidth -
      layout.cells
        .filter((id) => weights[id] === undefined)
        .reduce((sum, id) => sum + (measured.get(id) ?? widthOf(state.widths, id)), 0),
  );
  let remaining = [...flexible];
  const resolved = new Map<ColumnId, number>();
  let scale = 1;
  while (remaining.length) {
    const weight = remaining.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
    scale = weight > 0 ? pixels / weight : 0;
    const minimum = remaining.filter((id) => (weights[id] ?? 0) * scale < MIN_WIDTH);
    if (!minimum.length) break;
    for (const id of minimum) resolved.set(id, MIN_WIDTH);
    pixels = Math.max(0, pixels - minimum.length * MIN_WIDTH);
    remaining = remaining.filter((id) => !resolved.has(id));
  }
  let widths = state.widths;
  for (const id of DEFAULT_ORDER) {
    const weight = weights[id];
    if (weight === undefined) continue;
    widths = withWidth(widths, id, resolved.get(id) ?? Math.max(MIN_WIDTH, weight * scale));
  }
  return widths;
}

type Saved = Omit<ColumnsState, 'containerWidth'>;

/**
 * 同一个 store 里同一个存档键只有一份列宽、显隐与列序：两张表用同一个键时改一边另一边跟着变，落盘也不会
 * 拿各自的旧状态互相覆盖。缺省显隐与列宽取第一个建出来的那一份的。容器宽度各表自己量，不共用
 */
const shared = new WeakMap<Store, Map<string, PrimitiveAtom<Saved>>>();

function savedAtomFor(store: Store, key: string, load: () => StoredColumns): PrimitiveAtom<Saved> {
  let byKey = shared.get(store);
  if (!byKey) {
    byKey = new Map();
    shared.set(store, byKey);
  }
  let saved = byKey.get(key);
  if (!saved) {
    const stored = load();
    saved = atom<Saved>({
      widths: stored.widths,
      hidden: new Set(stored.hidden),
      order: stored.order,
      ...(stored.legacyWeights ? { legacyWeights: stored.legacyWeights } : {}),
    });
    byKey.set(key, saved);
  }
  return saved;
}

/** 建一张表的列模型：读回存档，状态写进 `store`。没有订阅与定时器，不用释放 */
export function createColumnsModel(store: Store, options: ColumnsOptions): ColumnsModel {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  let defaults = DEFAULT_WIDTHS;
  for (const [id, width] of Object.entries(options.widths ?? {})) {
    if (isColumnId(id) && typeof width === 'number') defaults = withWidth(defaults, id, width);
  }
  const fallback: StoredColumns = {
    widths: defaults,
    hidden: options.hidden ?? [],
    order: DEFAULT_ORDER,
  };
  const savedAtom = savedAtomFor(store, options.key, () => {
    const key =
      options.previousKey &&
      storage &&
      'available' in storage &&
      storage.available === false &&
      storage.getItem(options.key) === null
        ? options.previousKey
        : options.key;
    return loadColumns(storage, key, fallback, options.introduced);
  });
  const widthAtom = atom(0);
  const stateAtom = atom((get) => ({ ...get(savedAtom), containerWidth: get(widthAtom) }));
  const offered = [...options.offered];
  const layoutAtom = atom((get) => columnsLayout(get(stateAtom), offered));
  const read = () => store.get(stateAtom);
  const write = (patch: Partial<Saved>) =>
    store.set(savedAtom, { ...store.get(savedAtom), ...patch });
  const persist = () => {
    const { widths, hidden, order, legacyWeights } = read();
    saveColumns(storage, options.key, {
      widths,
      hidden: [...hidden],
      order,
      ...(legacyWeights ? { legacyWeights } : {}),
    });
  };

  return {
    offered,
    state: stateAtom,
    layout: layoutAtom,
    setContainerWidth(width) {
      if (Number.isFinite(width) && width >= 0 && width !== store.get(widthAtom)) {
        store.set(widthAtom, width);
        const state = read();
        if (width > 0 && state.legacyWeights) {
          const widths = resolveLegacyWidths(state, store.get(layoutAtom), new Map());
          store.set(savedAtom, { widths, hidden: state.hidden, order: state.order });
          persist();
        }
      }
    },
    beginResize(left, measured) {
      const layout = store.get(layoutAtom);
      if (!canResizeColumn(layout, left)) return null;
      const before = read();
      const start = before.widths;
      return {
        update(dx) {
          if (!Number.isFinite(dx)) return;
          if (left === 'cover') {
            const max = read().containerWidth / 3;
            const cover = Math.min(Math.max(layout.coverWidth + dx, 0), max);
            write({ widths: withWidth(start, 'cover', cover) });
            return;
          }
          const width = measured.get(left) ?? widthOf(start, left);
          write({ widths: withWidth(start, left, Math.max(MIN_WIDTH, width + dx)) });
        },
        commit: persist,
        cancel() {
          write({ widths: before.widths });
        },
      };
    },
    setHidden(id, hidden) {
      const current = read().hidden;
      if (id === REQUIRED_COLUMN || !offered.includes(id) || current.has(id) === hidden) return;
      const next = new Set(current);
      if (hidden) next.add(id);
      else next.delete(id);
      write({ hidden: next });
      persist();
    },
    moveColumn(source, target, after) {
      const order = read().order;
      const next = insertColumn(order, source, target, after);
      if (next.every((id, at) => id === order[at])) return;
      write({ order: next });
      persist();
    },
    moveAdjacent(source, direction) {
      const { cells } = store.get(layoutAtom);
      const at = cells.indexOf(source);
      const neighbor = at < 0 ? undefined : cells[at + direction];
      if (neighbor === undefined) return false;
      write({ order: insertColumn(read().order, source, neighbor, direction === 1) });
      persist();
      return true;
    },
    reset() {
      store.set(savedAtom, {
        widths: fallback.widths,
        hidden: new Set(fallback.hidden),
        order: fallback.order,
      });
      persist();
    },
  };
}
