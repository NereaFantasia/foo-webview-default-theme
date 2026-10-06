/**
 * 行空间（宿主的绝对行号）与显示空间（组头与曲目行混排后的虚拟位置）之间的换算。
 *
 * 纯函数模块：不引入响应式、不碰宿主。表格的虚拟滚动每帧按显示位置问很多次，所以换算走
 * 前缀和二分，不线性扫描；`runs` 变了才重建。
 *
 * 父游程只有一个子游程时**不为那个子组头分配显示位**——库里大多数
 * 专辑是单碟，而子模式 `$if2(%discnumber%,)` 无碟号时求值为空串、空串照样是一个键，不这样
 * 做的话每张单碟专辑底下都会多出一个空标题的子组头。组键为空串在这里也照常是一个键，兜底
 * 文案由界面渲染，不在这里替换：组键要与界面语言无关，折叠集合按它存。
 *
 * 折叠只作用于一级组。二级键在整表范围内不唯一（每张专辑都有「Disc 1」），单凭键标识不了
 * 某一个子组，因此不支持按二级键折叠。同理，非相邻的同键一级组会一起折叠——宿主只合并相邻游程
 * （同一张专辑在列表里出现两段就是两个组），按键折叠时这两段同进同出。接受这个代价，
 * 换取折叠状态不依赖会随列表变化平移的下标。
 */

import type { SelectionRange, SelectionRanges } from '../../table/rangeSelection.ts';

export interface GroupSubRun {
  readonly start: number;
  readonly count: number;
  readonly key: string;
}

export interface GroupRun {
  readonly start: number;
  readonly count: number;
  readonly key: string;
  readonly sub?: readonly GroupSubRun[];
}

export type GroupItem =
  | {
      readonly kind: 'header';
      readonly level: 1 | 2;
      readonly key: string;
      readonly count: number;
      /** 组内第一行的真实行号。组头的专辑、艺术家、年份与封面都从那一行取。 */
      readonly start: number;
      /** 所属父游程在 `runs` 里的下标。取封面要按它回查整条游程（子游程的起点是采样点）。 */
      readonly runIndex: number;
      /** 仅一级组会是 true：二级不参与折叠，见文件头。 */
      readonly collapsed: boolean;
    }
  | { readonly kind: 'row'; readonly index: number }
  /** 组不够高时垫在组尾的空位，好让封面块跨得下整组。不对应任何一行。 */
  | { readonly kind: 'filler' };

export interface GroupLayout {
  /** 显示空间的长度：组头数加可见行数，再加占位空位。表格的虚拟滚动按它算总高。 */
  readonly displayTotal: number;
  /** 显示位置上是什么；越界返回 `undefined`。 */
  itemAt(display: number): GroupItem | undefined;
  /** 某个真实行号在显示空间的位置；行被折叠或不在任何游程里时返回 -1。 */
  displayOf(rowIndex: number): number;
  /**
   * 从某个显示位向 `step` 方向找下一个曲目行的显示位，没有则 -1。键盘上下键用它跳过组头。
   *
   * 传 `-1` 配 `step: 1` 得到第一行，传 `displayTotal` 配 `step: -1` 得到最后一行，
   * Home / End 不需要另开入口。
   */
  nextRow(fromDisplay: number, step: 1 | -1): number;
  /**
   * 两个显示位之间（含两端）覆盖到的真实行号。Shift 扩选拿到的是用户看见的连续一段，
   * 而那一段里混着组头、占位空位，还可能跨过折叠的组。两端顺序任意。
   *
   * **折叠组内的行不在结果里**：它们本就不在显示空间中，用户也看不见。选中看不见的曲目，
   * 接下来的「移除」就会删掉屏幕上没有的东西。
   */
  rowsBetween(displayA: number, displayB: number): SelectionRanges;
}

/** 区间 `[from, to)` 内最后一个满足 `startOf(k) <= target` 的下标；没有则 -1。 */
function lastAtMost(
  from: number,
  to: number,
  target: number,
  startOf: (at: number) => number,
): number {
  let lo = from;
  let hi = to - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (startOf(mid) <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function buildGroupLayout(
  runs: readonly GroupRun[],
  collapsed: ReadonlySet<string> = new Set(),
  /**
   * 每组至少占多少行，不足的部分垫占位空位。封面列开着时取 `ceil(封面列宽 / 行高)`，
   * 关着或不分组时取 0。折叠的组不垫：它只剩组头一行，不显示封面。
   *
   * 比的是**曲目行数**而不是显示行数：二级组头只会让组更高，垫不垫都不影响封面放得下。
   */
  countMinimum = 0,
): GroupLayout {
  /** 每个父游程的组头所在显示位。 */
  const headerAt: number[] = [];
  /**
   * 子游程摊平成一条，父游程只记它在这条里的区间——与宿主侧同形。让父游程自持子数组的话，
   * 显示位要跟着子数组搬家，而这里每次重建都要从头算一遍。
   */
  const subs: GroupSubRun[] = [];
  const subBegin: number[] = [];
  /** 与 `subs` 对齐：每个子组头所在显示位。 */
  const subHeaderAt: number[] = [];
  /** 与 `runs` 对齐：占位空位从哪个显示位开始；没有占位则是 `Infinity`。 */
  const fillerFrom: number[] = [];

  let cursor = 0;
  for (const run of runs) {
    headerAt.push(cursor);
    subBegin.push(subs.length);
    cursor += 1;
    if (collapsed.has(run.key)) {
      fillerFrom.push(Number.POSITIVE_INFINITY);
      continue;
    }
    const children = run.sub ?? [];
    // 单子组不占显示位：它的行直接挂在父组下面，与没有二级分组时同形。
    if (children.length < 2) {
      cursor += run.count;
    } else {
      for (const child of children) {
        subs.push(child);
        subHeaderAt.push(cursor);
        cursor += 1 + child.count;
      }
    }
    const filler = Math.max(0, countMinimum - run.count);
    fillerFrom.push(filler > 0 ? cursor : Number.POSITIVE_INFINITY);
    cursor += filler;
  }
  subBegin.push(subs.length);

  const displayTotal = cursor;

  function itemAt(display: number): GroupItem | undefined {
    if (!Number.isInteger(display) || display < 0 || display >= displayTotal) return undefined;
    const at = lastAtMost(0, headerAt.length, display, (k) => headerAt[k] ?? 0);
    if (at < 0) return undefined;
    const run = runs[at];
    if (!run) return undefined;
    if (display === headerAt[at]) {
      return {
        kind: 'header',
        level: 1,
        key: run.key,
        count: run.count,
        start: run.start,
        runIndex: at,
        collapsed: collapsed.has(run.key),
      };
    }
    // 占位空位垫在组尾，判定要排在取行之前：它落在本组的显示区间里，却不对应任何行号。
    if (display >= (fillerFrom[at] ?? Number.POSITIVE_INFINITY)) return { kind: 'filler' };
    const begin = subBegin[at] ?? 0;
    const end = subBegin[at + 1] ?? begin;
    if (end === begin) {
      return { kind: 'row', index: run.start + (display - (headerAt[at] ?? 0) - 1) };
    }
    const sub = lastAtMost(begin, end, display, (k) => subHeaderAt[k] ?? 0);
    const child = subs[sub];
    if (!child) return undefined;
    if (display === subHeaderAt[sub]) {
      return {
        kind: 'header',
        level: 2,
        key: child.key,
        count: child.count,
        start: child.start,
        runIndex: at,
        collapsed: false,
      };
    }
    return { kind: 'row', index: child.start + (display - (subHeaderAt[sub] ?? 0) - 1) };
  }

  return {
    displayTotal,
    itemAt,

    displayOf(rowIndex: number): number {
      if (!Number.isInteger(rowIndex) || rowIndex < 0) return -1;
      const at = lastAtMost(0, runs.length, rowIndex, (k) => runs[k]?.start ?? 0);
      const run = runs[at];
      if (at < 0 || !run) return -1;
      // 行号落在最后一个游程之后：不属于任何组。
      if (rowIndex >= run.start + run.count) return -1;
      if (collapsed.has(run.key)) return -1;
      const begin = subBegin[at] ?? 0;
      const end = subBegin[at + 1] ?? begin;
      if (end === begin) return (headerAt[at] ?? 0) + 1 + (rowIndex - run.start);
      const sub = lastAtMost(begin, end, rowIndex, (k) => subs[k]?.start ?? 0);
      const child = subs[sub];
      if (sub < 0 || !child) return -1;
      return (subHeaderAt[sub] ?? 0) + 1 + (rowIndex - child.start);
    },

    // 展开态里组头是稀疏的，一两步就停；全折叠时显示空间本身只剩组头，扫描因此恒由组数
    // 封顶，不会退化成按行扫。
    nextRow(fromDisplay: number, step: 1 | -1): number {
      for (let at = fromDisplay + step; at >= 0 && at < displayTotal; at += step) {
        if (itemAt(at)?.kind === 'row') return at;
      }
      return -1;
    },

    rowsBetween(displayA: number, displayB: number): SelectionRanges {
      const lo = Math.max(0, Math.min(displayA, displayB));
      const hi = Math.min(displayTotal - 1, Math.max(displayA, displayB));
      const out: SelectionRange[] = [];
      if (lo > hi) return out;

      // 行在显示空间里是一段段连续的，每段整体换算一次即可——**不要按显示位逐个问 `itemAt`**，
      // 那样全选十万首就是十万次调用。段的行号递增，相接时并入上一段。
      const take = (displayStart: number, length: number, rowStart: number): void => {
        const from = Math.max(lo, displayStart);
        const to = Math.min(hi + 1, displayStart + length);
        if (from >= to) return;
        const rowFrom = rowStart + (from - displayStart);
        const rowTo = rowStart + (to - displayStart);
        const last = out[out.length - 1];
        if (last && last.end === rowFrom) out[out.length - 1] = { start: last.start, end: rowTo };
        else out.push({ start: rowFrom, end: rowTo });
      };

      let at = Math.max(
        0,
        lastAtMost(0, headerAt.length, lo, (k) => headerAt[k] ?? 0),
      );
      for (; at < runs.length; at += 1) {
        const run = runs[at];
        if (!run || (headerAt[at] ?? 0) > hi) break;
        // 折叠的组只有组头在显示空间里，组内的行一个都不收。
        if (collapsed.has(run.key)) continue;
        const begin = subBegin[at] ?? 0;
        const end = subBegin[at + 1] ?? begin;
        if (end === begin) {
          take((headerAt[at] ?? 0) + 1, run.count, run.start);
          continue;
        }
        for (let sub = begin; sub < end; sub += 1) {
          const child = subs[sub];
          if (child) take((subHeaderAt[sub] ?? 0) + 1, child.count, child.start);
        }
      }
      return out;
    },
  };
}
