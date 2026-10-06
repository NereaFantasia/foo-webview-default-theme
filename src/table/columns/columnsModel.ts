import { atom, type Atom, type PrimitiveAtom } from 'jotai/vanilla';
import { browserStorage, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import {
  columnDef,
  DEFAULT_ORDER,
  DEFAULT_WIDTHS,
  insertColumn,
  isColumnId,
  REQUIRED_COLUMN,
  resizePair,
  widthOf,
  withWidth,
  type ColumnId,
  type ColumnWidths,
} from './columns.ts';
import {
  columnsLayout,
  resizePartner,
  type ColumnsCompact,
  type ColumnsLayout,
  type ColumnsState,
} from './columnsLayout.ts';
import { loadColumns, saveColumns, type StoredColumns } from './columnsStorage.ts';

/** 一次分隔条拖动。`update` 收的是从按下起算的总位移，不累加。 */
export interface ColumnResize {
  update(dx: number): void;
  /** 松手：落盘。 */
  commit(): void;
  /** 取消：回到按下时的列宽，不落盘。 */
  cancel(): void;
}

export interface ColumnsOptions {
  /** localStorage 的键，一张表一个。 */
  readonly key: string;
  /** 这张表有哪几列；列头菜单只列这几列，存档里别的列原样留着。 */
  readonly offered: readonly ColumnId[];
  /** 没有存档时藏哪几列。 */
  readonly hidden?: readonly ColumnId[];
  /** 没有存档时与缺省不同的列宽。 */
  readonly widths?: Partial<Record<ColumnId, number>>;
  /** 缺省是页面的 localStorage。 */
  readonly storage?: PrefStorage | null;
  /** 容器不够宽时先收起的几列，见 `ColumnsCompact`。 */
  readonly compact?: ColumnsCompact;
}

export interface ColumnsModel {
  readonly offered: readonly ColumnId[];
  readonly state: Atom<ColumnsState>;
  readonly layout: Atom<ColumnsLayout>;
  /** 摆放表格的那一层量到容器宽度就报过来；窄档与封面列的上限跟着它走。 */
  setContainerWidth(width: number): void;
  /**
   * 按下 `left` 右缘的分隔条。`measured` 是按下这一刻各列的实测像素宽。没有分隔条的列答 null。
   * fr 列在这里换成实测像素当新权重，之后的位移与像素同一单位；比例随窗口缩放不变。
   */
  beginResize(left: ColumnId, measured: ReadonlyMap<ColumnId, number>): ColumnResize | null;
  setHidden(id: ColumnId, hidden: boolean): void;
  moveColumn(source: ColumnId, target: ColumnId, after: boolean): void;
  /**
   * 挪到看得见的相邻列另一侧（键盘换位），到头了答 false。只挪这一列，藏着的列（勾掉的、窄档收起的）相对顺序
   * 不动：窄档里换过位，放宽之后别的列还在原处。
   */
  moveAdjacent(source: ColumnId, direction: -1 | 1): boolean;
  /** 列宽、显隐与列序都回到建模型时的缺省，并落盘。 */
  reset(): void;
}

/** fr 列按实测像素重新定权重；看不见的 fr 列按同一比例换算，回来时仍是原来的比例。 */
function measuredWidths(
  state: ColumnsState,
  layout: ColumnsLayout,
  measured: ReadonlyMap<ColumnId, number>,
): ColumnWidths {
  const flexible = layout.cells.filter((id) => columnDef(id).flexible && measured.has(id));
  const weight = flexible.reduce((sum, id) => sum + widthOf(state.widths, id), 0);
  const pixels = flexible.reduce((sum, id) => sum + (measured.get(id) ?? 0), 0);
  const scale = weight > 0 && pixels > 0 ? pixels / weight : 1;
  let widths = state.widths;
  for (const id of DEFAULT_ORDER) {
    if (!columnDef(id).flexible) continue;
    const px = flexible.includes(id) ? measured.get(id) : undefined;
    widths = withWidth(widths, id, px ?? widthOf(state.widths, id) * scale);
  }
  return widths;
}

type Saved = Omit<ColumnsState, 'containerWidth'>;

/**
 * 同一个 store 里同一个存档键只有一份列宽、显隐与列序：两张表用同一个键时改一边另一边跟着变，落盘也不会
 * 拿各自的旧状态互相覆盖。缺省显隐与列宽取第一个建出来的那一份的。容器宽度各表自己量，不共用。
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
    });
    byKey.set(key, saved);
  }
  return saved;
}

/** 建一张表的列模型：读回存档，状态写进 `store`。没有订阅与定时器，不用释放。 */
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
  const savedAtom = savedAtomFor(store, options.key, () =>
    loadColumns(storage, options.key, fallback),
  );
  const widthAtom = atom(0);
  const stateAtom = atom((get) => ({ ...get(savedAtom), containerWidth: get(widthAtom) }));
  const offered = [...options.offered];
  const { compact } = options;
  const layoutAtom = atom((get) => columnsLayout(get(stateAtom), offered, compact));
  const read = () => store.get(stateAtom);
  const write = (patch: Partial<Saved>) =>
    store.set(savedAtom, { ...store.get(savedAtom), ...patch });
  const persist = () => {
    const { widths, hidden, order } = read();
    saveColumns(storage, options.key, { widths, hidden: [...hidden], order });
  };

  return {
    offered,
    state: stateAtom,
    layout: layoutAtom,
    setContainerWidth(width) {
      if (Number.isFinite(width) && width >= 0 && width !== store.get(widthAtom)) {
        store.set(widthAtom, width);
      }
    },
    beginResize(left, measured) {
      const layout = store.get(layoutAtom);
      const partner = resizePartner(layout, left);
      if (!partner) return null;
      const before = read();
      const start = partner === 'self' ? before.widths : measuredWidths(before, layout, measured);
      return {
        update(dx) {
          if (partner === 'self') {
            const max = read().containerWidth / 3;
            const cover = Math.min(Math.max(layout.coverWidth + dx, 0), max);
            write({ widths: withWidth(start, 'cover', cover) });
            return;
          }
          const [a, b] = resizePair(widthOf(start, left), widthOf(start, partner), dx);
          write({ widths: withWidth(withWidth(start, left, a), partner, b) });
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
      write({
        widths: fallback.widths,
        hidden: new Set(fallback.hidden),
        order: fallback.order,
      });
      persist();
    },
  };
}
