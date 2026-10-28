/**
 * 维护连续分组与降序展示次序，同值项保持宿主原始相对次序，组序独立于排序方向
 * 比较规则完全由调用方传入的判等函数决定
 */
export interface RunOrder<T> {
  /** 外层分组键；连续相同键归为一组，未指定时全局视为单组 */
  readonly groupOf?: (item: T) => string;
  /** 是否反转各分组之间的先后次序（组内项顺序保持不变） */
  readonly groupDescending?: boolean;
  /** 组内次序固定的子段单元键（如分碟）；降序排列不跨越子段边界 */
  readonly cellOf?: (item: T) => string;
  /** 主键相等性判别函数；未提供时不执行降序重排，保持原有次序 */
  readonly same?: (a: T, b: T) => boolean;
  /** 是否反转各主键段的先后次序（相同主键段内部保持原有相对次序） */
  readonly descending?: boolean;
}

/** 将相邻且满足 `joined` 条件的连续元素归并为分段；纯函数不改变入参 */
function runsOf<T>(items: readonly T[], joined: (before: T, after: T) => boolean): T[][] {
  const runs: T[][] = [];
  for (let at = 0; at < items.length; at += 1) {
    const item = items[at];
    const run = runs.at(-1);
    if (run && joined(items[at - 1], item)) run.push(item);
    else runs.push([item]);
  }
  return runs;
}

/**
 * 按 `RunOrder` 规范整理升序结果
 * 当存在相同键值时，同值段内保持原有相对次序，仅反转不同键值段之间的先后顺序
 */
export function arrangeRuns<T>(items: readonly T[], order: RunOrder<T>): T[] {
  const { groupOf, cellOf, same } = order;
  const groups = runsOf(items, (a, b) => !groupOf || groupOf(a) === groupOf(b));
  if (order.groupDescending) groups.reverse();
  if (!order.descending || !same) return groups.flat();
  return groups.flatMap((group) =>
    runsOf(group, (a, b) => !cellOf || cellOf(a) === cellOf(b)).flatMap((cell) =>
      runsOf(cell, same).reverse().flat(),
    ),
  );
}
