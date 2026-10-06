import { describe, expect, it } from 'vitest';
import { buildGroupLayout, type GroupRun } from '../../../../src/playlist/groups/groupLayout.ts';

/**
 * 显示空间映射：组头与曲目行混排后的位置换算。覆盖空列表、单组、每行一组的
 * 最坏形态、折叠、首尾边界、单子组不出子组头而多子组出，以及行的往返一致性。
 */

/** 遍历整个显示空间，逐条验 `displayOf(itemAt(d).index) === d`。 */
function assertRoundTrip(
  runs: readonly GroupRun[],
  collapsed?: Set<string>,
  countMinimum?: number,
): void {
  const layout = buildGroupLayout(runs, collapsed, countMinimum);
  for (let display = 0; display < layout.displayTotal; display += 1) {
    const item = layout.itemAt(display);
    const message = `显示位 ${display} 应当有条目`;
    expect(item, message).toBeDefined();
    if (!item) throw new Error(message);
    if (item.kind === 'row') expect(layout.displayOf(item.index)).toBe(display);
  }
}

describe('buildGroupLayout', () => {
  it('空列表没有显示位，任何查询都落空', () => {
    const layout = buildGroupLayout([]);
    expect(layout.displayTotal).toBe(0);
    expect(layout.itemAt(0)).toBe(undefined);
    expect(layout.displayOf(0)).toBe(-1);
  });

  it('单个一级组：组头一位，其后是组内各行', () => {
    const runs: GroupRun[] = [{ start: 0, count: 3, key: 'A' }];
    const layout = buildGroupLayout(runs);
    expect(layout.displayTotal).toBe(4);
    expect(layout.itemAt(0)).toStrictEqual({
      kind: 'header',
      level: 1,
      key: 'A',
      count: 3,
      start: 0,
      runIndex: 0,
      collapsed: false,
    });
    expect(layout.itemAt(1)).toStrictEqual({ kind: 'row', index: 0 });
    expect(layout.itemAt(3)).toStrictEqual({ kind: 'row', index: 2 });
    expect(layout.itemAt(4)).toBe(undefined);
    expect(layout.displayOf(0)).toBe(1);
    expect(layout.displayOf(2)).toBe(3);
    // 行号超出最后一个游程：不属于任何组
    expect(layout.displayOf(3)).toBe(-1);
    assertRoundTrip(runs);
  });

  it('相邻两组：第二组的组头排在第一组末行之后', () => {
    const runs: GroupRun[] = [
      { start: 0, count: 3, key: 'A' },
      { start: 3, count: 2, key: 'B' },
    ];
    const layout = buildGroupLayout(runs);
    expect(layout.displayTotal).toBe(7);
    expect(layout.itemAt(4)).toStrictEqual({
      kind: 'header',
      level: 1,
      key: 'B',
      count: 2,
      start: 3,
      runIndex: 1,
      collapsed: false,
    });
    expect(layout.itemAt(5)).toStrictEqual({ kind: 'row', index: 3 });
    expect(layout.displayOf(3)).toBe(5);
    assertRoundTrip(runs);
  });

  it('每行一组的最坏形态：显示位恰好是行数的两倍', () => {
    const runs: GroupRun[] = Array.from({ length: 5 }, (_, at) => ({
      start: at,
      count: 1,
      key: `K${at}`,
    }));
    const layout = buildGroupLayout(runs);
    expect(layout.displayTotal).toBe(10);
    for (let at = 0; at < 5; at += 1) {
      expect(layout.itemAt(at * 2)).toStrictEqual({
        kind: 'header',
        level: 1,
        key: `K${at}`,
        count: 1,
        start: at,
        runIndex: at,
        collapsed: false,
      });
      expect(layout.itemAt(at * 2 + 1)).toStrictEqual({ kind: 'row', index: at });
    }
    assertRoundTrip(runs);
  });

  it('单子组不占显示位：形态与没有二级分组时相同', () => {
    const withSub: GroupRun[] = [
      { start: 0, count: 3, key: 'A', sub: [{ start: 0, count: 3, key: 'Disc 1' }] },
    ];
    const withoutSub: GroupRun[] = [{ start: 0, count: 3, key: 'A' }];
    const layout = buildGroupLayout(withSub);
    const plain = buildGroupLayout(withoutSub);
    expect(layout.displayTotal).toBe(plain.displayTotal);
    for (let display = 0; display < layout.displayTotal; display += 1) {
      expect(layout.itemAt(display)).toStrictEqual(plain.itemAt(display));
    }
    assertRoundTrip(withSub);
  });

  it('两个及以上子组才出子组头，且子组头的起点是绝对行号', () => {
    // 第二个父组是鉴别用例：它的子组起点是 2 与 4，不是父内偏移 0 与 2。
    const runs: GroupRun[] = [
      { start: 0, count: 2, key: 'A' },
      {
        start: 2,
        count: 4,
        key: 'B',
        sub: [
          { start: 2, count: 2, key: 'B1' },
          { start: 4, count: 2, key: 'B2' },
        ],
      },
    ];
    const layout = buildGroupLayout(runs);
    expect(layout.displayTotal).toBe(10);
    expect(layout.itemAt(3)).toStrictEqual({
      kind: 'header',
      level: 1,
      key: 'B',
      count: 4,
      start: 2,
      runIndex: 1,
      collapsed: false,
    });
    expect(layout.itemAt(4)).toStrictEqual({
      kind: 'header',
      level: 2,
      key: 'B1',
      count: 2,
      start: 2,
      runIndex: 1,
      collapsed: false,
    });
    expect(layout.itemAt(5)).toStrictEqual({ kind: 'row', index: 2 });
    expect(layout.itemAt(7)).toStrictEqual({
      kind: 'header',
      level: 2,
      key: 'B2',
      count: 2,
      start: 4,
      runIndex: 1,
      collapsed: false,
    });
    expect(layout.itemAt(8)).toStrictEqual({ kind: 'row', index: 4 });
    expect(layout.itemAt(9)).toStrictEqual({ kind: 'row', index: 5 });
    expect(layout.itemAt(10)).toBe(undefined);
    expect(layout.displayOf(4)).toBe(8);
    assertRoundTrip(runs);
  });

  it('折叠一级组：组内行退出显示空间，后续组头随之上移', () => {
    const runs: GroupRun[] = [
      { start: 0, count: 3, key: 'A' },
      { start: 3, count: 2, key: 'B' },
    ];
    const layout = buildGroupLayout(runs, new Set(['A']));
    expect(layout.displayTotal).toBe(4);
    expect(layout.itemAt(0)).toStrictEqual({
      kind: 'header',
      level: 1,
      key: 'A',
      count: 3,
      start: 0,
      runIndex: 0,
      collapsed: true,
    });
    expect(layout.itemAt(1)).toStrictEqual({
      kind: 'header',
      level: 1,
      key: 'B',
      count: 2,
      start: 3,
      runIndex: 1,
      collapsed: false,
    });
    expect(layout.itemAt(2)).toStrictEqual({ kind: 'row', index: 3 });
    // 折叠组里的行没有显示位，调用方据此知道选中行当前不可见
    expect(layout.displayOf(0)).toBe(-1);
    expect(layout.displayOf(3)).toBe(2);
    assertRoundTrip(runs, new Set(['A']));
  });

  it('折叠带子组的父组：子组头也一并退出', () => {
    const runs: GroupRun[] = [
      { start: 0, count: 2, key: 'A' },
      {
        start: 2,
        count: 4,
        key: 'B',
        sub: [
          { start: 2, count: 2, key: 'B1' },
          { start: 4, count: 2, key: 'B2' },
        ],
      },
    ];
    const layout = buildGroupLayout(runs, new Set(['B']));
    expect(layout.displayTotal).toBe(4);
    expect(layout.itemAt(3)).toStrictEqual({
      kind: 'header',
      level: 1,
      key: 'B',
      count: 4,
      start: 2,
      runIndex: 1,
      collapsed: true,
    });
    expect(layout.itemAt(4)).toBe(undefined);
    expect(layout.displayOf(2)).toBe(-1);
    assertRoundTrip(runs, new Set(['B']));
  });

  it('非相邻的同键组按键一起折叠，这是折叠标识不用下标换来的代价', () => {
    const runs: GroupRun[] = [
      { start: 0, count: 2, key: 'A' },
      { start: 2, count: 2, key: 'B' },
      { start: 4, count: 2, key: 'A' },
    ];
    const layout = buildGroupLayout(runs, new Set(['A']));
    // 两段 A 都只剩组头：1 + (1 + 2) + 1
    expect(layout.displayTotal).toBe(5);
    expect(layout.displayOf(0)).toBe(-1);
    expect(layout.displayOf(4)).toBe(-1);
    expect(layout.displayOf(2)).toBe(2);
    assertRoundTrip(runs, new Set(['A']));
  });

  it('nextRow 跳过组头，并用越界起点表达 Home 与 End', () => {
    const layout = buildGroupLayout([
      { start: 0, count: 2, key: 'A' },
      { start: 2, count: 2, key: 'B' },
    ]);
    // 显示空间：组头 0，行 1-2，组头 3，行 4-5
    expect(layout.nextRow(2, 1), '越过组头落到下一组首行').toBe(4);
    expect(layout.nextRow(4, -1), '反向同理').toBe(2);
    expect(layout.nextRow(-1, 1), 'Home：第一行').toBe(1);
    expect(layout.nextRow(layout.displayTotal, -1), 'End：最后一行').toBe(5);
    expect(layout.nextRow(5, 1), '已在末行则不动').toBe(-1);
    expect(layout.nextRow(1, -1), '已在首行则不动').toBe(-1);
  });

  it('全部折叠时显示空间只剩组头，nextRow 找不到行', () => {
    const layout = buildGroupLayout(
      [
        { start: 0, count: 2, key: 'A' },
        { start: 2, count: 2, key: 'B' },
      ],
      new Set(['A', 'B']),
    );
    expect(layout.displayTotal).toBe(2);
    expect(layout.nextRow(-1, 1)).toBe(-1);
    expect(layout.nextRow(layout.displayTotal, -1)).toBe(-1);
  });

  it('空组键照常是一个键，映射不替换文案', () => {
    const runs: GroupRun[] = [{ start: 0, count: 2, key: '' }];
    const layout = buildGroupLayout(runs);
    expect(layout.itemAt(0)).toStrictEqual({
      kind: 'header',
      level: 1,
      key: '',
      count: 2,
      start: 0,
      runIndex: 0,
      collapsed: false,
    });
    expect(layout.displayTotal).toBe(3);
  });

  it('非法的显示位与行号一律落空，不抛也不返回越界条目', () => {
    const layout = buildGroupLayout([{ start: 0, count: 2, key: 'A' }]);
    expect(layout.itemAt(-1)).toBe(undefined);
    expect(layout.itemAt(1.5)).toBe(undefined);
    expect(layout.itemAt(99)).toBe(undefined);
    expect(layout.displayOf(-1)).toBe(-1);
    expect(layout.displayOf(1.5)).toBe(-1);
    expect(layout.displayOf(99)).toBe(-1);
  });

  it('组内行数不足时垫占位空位，垫够为止', () => {
    const runs: GroupRun[] = [
      { start: 0, count: 1, key: 'A' },
      { start: 1, count: 4, key: 'B' },
    ];
    const layout = buildGroupLayout(runs, undefined, 3);
    // A 组：组头 + 1 行 + 2 个占位；B 组已经够高，不垫
    expect(layout.displayTotal).toBe(1 + 3 + 1 + 4);
    expect(layout.itemAt(1)).toStrictEqual({ kind: 'row', index: 0 });
    expect(layout.itemAt(2)).toStrictEqual({ kind: 'filler' });
    expect(layout.itemAt(3)).toStrictEqual({ kind: 'filler' });
    expect(layout.itemAt(4)?.kind).toBe('header');
    expect(layout.itemAt(5)).toStrictEqual({ kind: 'row', index: 1 });
    // 占位不对应行号，行的换算不受影响
    expect(layout.displayOf(0)).toBe(1);
    expect(layout.displayOf(1)).toBe(5);
    assertRoundTrip(runs, undefined, 3);
  });

  it('占位不进键盘遍历：上下键从组内最后一行直接跳到下一组的行', () => {
    const layout = buildGroupLayout(
      [
        { start: 0, count: 1, key: 'A' },
        { start: 1, count: 1, key: 'B' },
      ],
      undefined,
      3,
    );
    expect(layout.nextRow(1, 1)).toBe(5);
    expect(layout.nextRow(5, -1)).toBe(1);
    // 末组尾部的占位之后没有行了
    expect(layout.nextRow(5, 1)).toBe(-1);
  });

  it('折叠的组不垫占位：它只剩组头一行，封面本来就不画', () => {
    const layout = buildGroupLayout(
      [
        { start: 0, count: 1, key: 'A' },
        { start: 1, count: 1, key: 'B' },
      ],
      new Set(['A']),
      3,
    );
    // A 折叠只占组头一位，B 展开后垫到 3 行
    expect(layout.displayTotal).toBe(1 + 1 + 3);
    expect(layout.itemAt(1)?.kind).toBe('header');
    expect(layout.itemAt(2)).toStrictEqual({ kind: 'row', index: 1 });
    expect(layout.itemAt(4)).toStrictEqual({ kind: 'filler' });
  });

  it('两级分组按曲目行数垫，子组头只会让组更高', () => {
    const runs: GroupRun[] = [
      {
        start: 0,
        count: 2,
        key: 'A',
        sub: [
          { start: 0, count: 1, key: '1' },
          { start: 1, count: 1, key: '2' },
        ],
      },
    ];
    const layout = buildGroupLayout(runs, undefined, 3);
    // 组头 + 两个子组头 + 两行 + 1 个占位
    expect(layout.displayTotal).toBe(1 + 2 + 2 + 1);
    expect(layout.itemAt(5)).toStrictEqual({ kind: 'filler' });
    assertRoundTrip(runs, undefined, 3);
  });

  it('下限为 0 时一个占位都不垫，与未开封面列时同形', () => {
    const runs: GroupRun[] = [{ start: 0, count: 1, key: 'A' }];
    expect(buildGroupLayout(runs, undefined, 0).displayTotal).toBe(2);
    expect(buildGroupLayout(runs).displayTotal).toBe(2);
  });
});

/**
 * 显示区间到真实行号的换算（Shift 扩选用）。重点在三件事：组头与占位空位不换出行号、
 * 折叠组内的行一个都不收、行号相接的段合并成一段。
 */

/** 三组各自展开后的显示空间：0 组头 / 1-2 行 / 3 组头 / 4-6 行 / 7 组头 / 8-9 行。 */
const THREE: GroupRun[] = [
  { start: 0, count: 2, key: 'A' },
  { start: 2, count: 3, key: 'B' },
  { start: 5, count: 2, key: 'C' },
];

describe('buildGroupLayout 的 rowsBetween', () => {
  it('覆盖整个显示空间时结果恰为单个区间', () => {
    const layout = buildGroupLayout(THREE);
    expect(layout.displayTotal).toBe(10);
    expect(layout.rowsBetween(0, 9)).toStrictEqual([{ start: 0, end: 7 }]);
  });

  it('两端都落在组头上：组头自己不换出行号，中间的行照收', () => {
    const layout = buildGroupLayout(THREE);
    // 显示位 3 与 7 都是组头，中间是 B 组的三行。
    expect(layout.rowsBetween(3, 7)).toStrictEqual([{ start: 2, end: 5 }]);
  });

  it('单个组头自成一段时结果为空', () => {
    const layout = buildGroupLayout(THREE);
    expect(layout.rowsBetween(0, 0)).toStrictEqual([]);
  });

  it('跨组的一段把两侧的行并成连续区间', () => {
    const layout = buildGroupLayout(THREE);
    // 显示位 2 是 A 的末行（行 1），4 是 B 的首行（行 2）；行号相接，合并成一段。
    expect(layout.rowsBetween(2, 4)).toStrictEqual([{ start: 1, end: 3 }]);
  });

  it('跨过折叠的组时，折叠组内的行一个都不收，结果因此断成两段', () => {
    const layout = buildGroupLayout(THREE, new Set(['B']));
    // 折叠后：0 组头A / 1-2 行 / 3 组头B（折叠）/ 4 组头C / 5-6 行。
    expect(layout.displayTotal).toBe(7);
    expect(layout.rowsBetween(0, 6)).toStrictEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
  });

  it('两端顺序任意', () => {
    const layout = buildGroupLayout(THREE, new Set(['B']));
    expect(layout.rowsBetween(6, 0)).toStrictEqual(layout.rowsBetween(0, 6));
  });

  it('越界的两端被夹回显示空间', () => {
    const layout = buildGroupLayout(THREE);
    expect(layout.rowsBetween(-20, 999)).toStrictEqual([{ start: 0, end: 7 }]);
    expect(layout.rowsBetween(-5, -1)).toStrictEqual([]);
  });

  it('空列表返回空', () => {
    const layout = buildGroupLayout([]);
    expect(layout.rowsBetween(0, 10)).toStrictEqual([]);
  });

  it('二级组头不换出行号，跨子组的行号仍相接', () => {
    const runs: GroupRun[] = [
      {
        start: 0,
        count: 4,
        key: 'A',
        sub: [
          { start: 0, count: 2, key: '1' },
          { start: 2, count: 2, key: '2' },
        ],
      },
    ];
    const layout = buildGroupLayout(runs);
    // 0 组头A / 1 子组头1 / 2-3 行 / 4 子组头2 / 5-6 行。
    expect(layout.displayTotal).toBe(7);
    expect(layout.rowsBetween(0, 6)).toStrictEqual([{ start: 0, end: 4 }]);
    // 显示位 3 是行 1、4 是子组头、5 是行 2：中间的子组头不该把区间截断。
    expect(layout.rowsBetween(3, 5)).toStrictEqual([{ start: 1, end: 3 }]);
  });

  it('占位空位不换出行号', () => {
    const runs: GroupRun[] = [
      { start: 0, count: 1, key: 'A' },
      { start: 1, count: 1, key: 'B' },
    ];
    const layout = buildGroupLayout(runs, undefined, 3);
    // 每组补两个占位：0 组头 / 1 行 / 2-3 占位 / 4 组头 / 5 行 / 6-7 占位。
    expect(layout.displayTotal).toBe(8);
    expect(layout.rowsBetween(2, 3)).toStrictEqual([]);
    expect(layout.rowsBetween(0, 7)).toStrictEqual([{ start: 0, end: 2 }]);
  });

  it('结果与逐位问 itemAt 得到的行号一致', () => {
    const collapsed = new Set(['B']);
    for (const countMinimum of [0, 3]) {
      const layout = buildGroupLayout(THREE, collapsed, countMinimum);
      for (let lo = 0; lo < layout.displayTotal; lo += 1) {
        for (let hi = lo; hi < layout.displayTotal; hi += 1) {
          const expected: number[] = [];
          for (let at = lo; at <= hi; at += 1) {
            const item = layout.itemAt(at);
            if (item?.kind === 'row') expected.push(item.index);
          }
          const actual: number[] = [];
          for (const range of layout.rowsBetween(lo, hi)) {
            for (let row = range.start; row < range.end; row += 1) actual.push(row);
          }
          expect(actual, `显示区间 [${lo}, ${hi}] 不一致`).toStrictEqual(expected);
        }
      }
    }
  });
});
