import { atom, type Atom } from 'jotai/vanilla';
import type { Modifiers } from '../kit/keyedSelection.ts';
import type { Store } from '../kit/store.ts';
import {
  addRange,
  clampRanges,
  containsRow,
  countRows,
  intersectRanges,
  NO_RANGES,
  removeRange,
  sameRanges,
  toggleRow,
  type SelectionRange,
  type SelectionRanges,
} from './rangeSelection.ts';

export interface RowSelectionState {
  readonly ranges: SelectionRanges;
  /** Shift 扩选的固定端，行序号；-1 表示还没有。 */
  readonly anchor: number;
}

export interface RowSelectionOptions {
  readonly total: number;
  /**
   * Shift 扩选与全选只收这些行。不给就是全部行，折叠起来看不见的行也会被扩选带进去；给了就只收它们，
   * 例如只给看得见的行。
   */
  readonly reachable?: () => SelectionRanges;
}

export interface RowSelection {
  readonly state: Atom<RowSelectionState>;
  /** 单击或键盘落到一行上，按修饰键改选中。越界的行不动。 */
  activate(at: number, modifiers: Modifiers): void;
  /**
   * 一次选中一段行序号 [start, end)，如单击分组头选中整张专辑。修饰键与单行同一套：不带只选这一段、锚落在
   * 段首；Ctrl 切换这一段（整段都已选中时去掉，否则并进来）；Shift 选锚到这一段远端的一整截。越界的部分裁掉。
   */
  selectSpan(start: number, end: number, modifiers: Modifiers): void;
  /**
   * 右键落在一行上，答菜单作用于哪些行：它已在选中里就是整批，选中不变；不在就改为只选它、只作用于它。
   * 越界时什么都不作用。整批含折叠起来看不见的已选行：Shift 扩选跨过折叠的分组时，里面的行本来就算选中。
   */
  menuAt(at: number): SelectionRanges;
  selectAll(): void;
  clear(): void;
  /**
   * 行数变了：越界的选中裁掉，锚越界就撤掉。只适用于在尾部追加或截断；行重新排过（换排序、换分节、换了一批
   * 行）时行序号全变了，要 `clear()`。
   */
  setTotal(total: number): void;
  /**
   * 整份换成外面给的选中，如宿主报来的那一份：越界的裁掉，锚越界就撤掉、不越界留着。与此刻相同时不写。
   */
  replace(ranges: SelectionRanges): void;
}

/**
 * 一张表的本地多选，不写宿主：库里的曲目不在任何播放列表里，这份选中只服务于菜单与拖动的「这一批」。
 * 手势与封面墙同一套：不带修饰键只选它并落锚；Ctrl 切换这一行并把锚移过来；Shift 选锚到它的一段，
 * 替换原选中；Ctrl+Shift 把这一段并进原选中；还没有锚时 Shift 当没按。行序号怎么排、什么时候清空
 * （换了一批行、重新排序）归表格的调用方。
 */
export function createRowSelection(store: Store, options: RowSelectionOptions): RowSelection {
  const stateAtom = atom<RowSelectionState>({ ranges: NO_RANGES, anchor: -1 });
  let total = Math.max(0, options.total);
  const read = () => store.get(stateAtom);
  const write = (next: RowSelectionState) => {
    const current = read();
    if (current.anchor !== next.anchor || !sameRanges(current.ranges, next.ranges)) {
      store.set(stateAtom, next);
    }
  };
  const inRange = (at: number) => Number.isInteger(at) && at >= 0 && at < total;
  const reachable = (ranges: SelectionRanges) =>
    options.reachable ? intersectRanges(ranges, options.reachable()) : ranges;
  const only = (at: number) => write({ ranges: addRange(NO_RANGES, at, at + 1), anchor: at });

  return {
    state: atom((get) => get(stateAtom)),
    activate(at, modifiers) {
      if (!inRange(at)) return;
      const { ranges, anchor } = read();
      if (modifiers.shift && inRange(anchor)) {
        const span = reachable(addRange(NO_RANGES, Math.min(anchor, at), Math.max(anchor, at) + 1));
        write({ ranges: modifiers.ctrl ? span.reduce(merge, ranges) : span, anchor });
        return;
      }
      if (modifiers.ctrl) write({ ranges: toggleRow(ranges, at), anchor: at });
      else only(at);
    },
    selectSpan(start, end, modifiers) {
      const from = Math.max(0, Math.trunc(start));
      const to = Math.min(total, Math.trunc(end));
      if (!(from < to)) return;
      const { ranges, anchor } = read();
      if (modifiers.shift && inRange(anchor)) {
        const span = reachable(
          addRange(NO_RANGES, Math.min(anchor, from), Math.max(anchor + 1, to)),
        );
        write({ ranges: modifiers.ctrl ? span.reduce(merge, ranges) : span, anchor });
        return;
      }
      if (!modifiers.ctrl) {
        write({ ranges: addRange(NO_RANGES, from, to), anchor: from });
        return;
      }
      const whole = countRows(intersectRanges(ranges, addRange(NO_RANGES, from, to))) === to - from;
      write({
        ranges: whole ? removeRange(ranges, from, to) : addRange(ranges, from, to),
        anchor: from,
      });
    },
    menuAt(at) {
      if (!inRange(at)) return NO_RANGES;
      const { ranges } = read();
      if (containsRow(ranges, at)) return ranges;
      only(at);
      return read().ranges;
    },
    selectAll() {
      if (total === 0) return;
      const ranges = reachable(addRange(NO_RANGES, 0, total));
      write({ ranges, anchor: ranges[0]?.start ?? -1 });
    },
    clear() {
      write({ ranges: NO_RANGES, anchor: -1 });
    },
    setTotal(next) {
      total = Math.max(0, next);
      const { ranges, anchor } = read();
      write({ ranges: clampRanges(ranges, total), anchor: anchor < total ? anchor : -1 });
    },
    replace(next) {
      const { anchor } = read();
      write({ ranges: clampRanges(next, total), anchor: anchor < total ? anchor : -1 });
    },
  };
}

function merge(into: SelectionRanges, range: SelectionRange): SelectionRanges {
  return addRange(into, range.start, range.end);
}
