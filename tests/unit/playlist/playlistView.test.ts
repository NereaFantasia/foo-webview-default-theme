import { describe, expect, it } from 'vitest';
import type { GroupRun } from '../../../src/playlist/groups/groupLayout.ts';
import type { PlaylistHit } from '../../../src/playlist/filter/playlistFilter.ts';
import type { PlaylistRow } from '../../../src/playlist/playlistRow.ts';
import {
  buildPlaylistView,
  type PlaylistItem,
  type PlaylistViewInput,
} from '../../../src/playlist/playlistView.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

// 表格看到的那份条目流：扁平、分组、过滤三种形态同一套坐标，行序号就是宿主行号。显示位与行号之间的换算
// 只在这一层，播放、选中与定位都从这里过，所以换算是本文件的主判据。

function row(index: number, title = `曲目 ${index}`): PlaylistRow {
  return { ...makeTrack({ path: `file://E:/Music/${index}.flac`, title }), albumArtist: '' };
}

/** 五行分成两组：0-2 与 3-4。显示空间因此是 组头 0 1 2 组头 3 4。 */
const TWO_GROUPS: readonly GroupRun[] = [
  { start: 0, count: 3, key: '甲专辑' },
  { start: 3, count: 2, key: '乙专辑' },
];

function input(overrides: Partial<PlaylistViewInput> = {}): PlaylistViewInput {
  const cached = new Map(Array.from({ length: 5 }, (_, at) => [at, row(at)]));
  return {
    total: 5,
    rowAt: (at) => cached.get(at),
    stampAt: (at) => (cached.has(at) ? 10 + at : undefined),
    currentAt: (at) => cached.has(at),
    filter: null,
    grouping: false,
    runs: [],
    collapsed: new Set(),
    groupsLoading: false,
    groupsFailed: false,
    countMinimum: 0,
    ...overrides,
  };
}

/** 条目流的样子：行写成行号，组头写成 `g` 加组键，空位写成 `-`。 */
function shapeOf(items: readonly PlaylistItem[]): string[] {
  return items.map((item) =>
    item.kind === 'row' ? String(item.order) : item.kind === 'group' ? `g${item.data.key}` : '-',
  );
}

describe('扁平态', () => {
  it('位置就是行号，条目全是曲目行；越界答 -1', () => {
    const view = buildPlaylistView(input());
    expect(view.shape).toBe('flat');
    expect(shapeOf(view.items)).toEqual(['0', '1', '2', '3', '4']);
    expect(view.rowOf(3)).toBe(3);
    expect(view.displayOf(4)).toBe(4);
    expect(view.rowOf(5)).toBe(-1);
    expect(view.displayOf(-1)).toBe(-1);
    expect(view.reachable()).toEqual([{ start: 0, end: 5 }]);
  });

  it('还没取到的行画骨架；评分戳按行取，没取到的按 0', () => {
    const view = buildPlaylistView(input({ total: 7 }));
    const last = view.items[6];
    expect(last?.kind === 'row' ? last.track : 'missing').toBeUndefined();
    const first = view.items[1];
    if (first?.kind !== 'row') throw new Error('第二条应是曲目行');
    expect(view.stampOf(first)).toBe(11);
    expect(view.stampOf({ kind: 'row', key: 'r6', order: 6, track: undefined })).toBe(0);
  });
});

describe('分组态', () => {
  it('组头混排进条目流，行按显示位换回真实行号，落在组头上答 -1', () => {
    const view = buildPlaylistView(input({ grouping: true, runs: TWO_GROUPS }));
    expect(view.shape).toBe('grouped');
    expect(shapeOf(view.items)).toEqual(['g甲专辑', '0', '1', '2', 'g乙专辑', '3', '4']);
    expect(view.rowOf(5)).toBe(3);
    expect(view.rowOf(4)).toBe(-1);
    expect(view.displayOf(3)).toBe(5);
    expect(view.displayOf(9)).toBe(-1);
  });

  it('组头带着组内第一行：第二组读它自己的首行，不是整表第一行', () => {
    const view = buildPlaylistView(input({ runs: TWO_GROUPS }));
    const second = view.items[4];
    if (second?.kind !== 'group') throw new Error('显示位 4 应是组头');
    expect(second.level).toBe(0);
    expect(second.data).toMatchObject({ level: 1, start: 3, count: 2, runIndex: 1 });
    expect(second.data.row?.title).toBe('曲目 3');
  });

  it('折叠后组内行退出条目流，也不在全选与扩选的范围里；认得出行在哪个折起的组里', () => {
    const view = buildPlaylistView(input({ runs: TWO_GROUPS, collapsed: new Set(['甲专辑']) }));
    expect(shapeOf(view.items)).toEqual(['g甲专辑', 'g乙专辑', '3', '4']);
    expect(view.items[0]?.kind === 'group' && view.items[0].collapsed).toBe(true);
    expect(view.displayOf(1)).toBe(-1);
    expect(view.collapsedGroupOf(1)).toBe('甲专辑');
    expect(view.collapsedGroupOf(3)).toBeNull();
    expect(view.collapsedGroupOf(7)).toBeNull();
    expect(view.reachable()).toEqual([{ start: 3, end: 5 }]);
  });

  it('键跨开合稳定：行按行号，组头按级别与首行', () => {
    const open = buildPlaylistView(input({ runs: TWO_GROUPS }));
    const shut = buildPlaylistView(input({ runs: TWO_GROUPS, collapsed: new Set(['甲专辑']) }));
    expect(open.items.map((item) => item.key)).toEqual(
      expect.arrayContaining(shut.items.map((item) => item.key)),
    );
    expect(shut.items.map((item) => item.key)).toEqual(['g1:0', 'g1:3', 'r3', 'r4']);
  });

  it('两级游程：子组头在一级组头之下，只有一个子组时不占位', () => {
    const runs: GroupRun[] = [
      {
        start: 0,
        count: 3,
        key: '甲专辑',
        sub: [
          { start: 0, count: 2, key: 'Disc 1' },
          { start: 2, count: 1, key: 'Disc 2' },
        ],
      },
      { start: 3, count: 2, key: '乙专辑', sub: [{ start: 3, count: 2, key: 'Disc 1' }] },
    ];
    const view = buildPlaylistView(input({ runs }));
    expect(shapeOf(view.items)).toEqual([
      'g甲专辑',
      'gDisc 1',
      '0',
      '1',
      'gDisc 2',
      '2',
      'g乙专辑',
      '3',
      '4',
    ]);
    const disc = view.items[1];
    expect(disc?.kind === 'group' ? [disc.level, disc.key] : null).toEqual([1, 'g2:0']);
  });

  it('组不够高时在组尾垫空位，空位不是行、键各不相同', () => {
    const view = buildPlaylistView(input({ runs: TWO_GROUPS, countMinimum: 3 }));
    expect(shapeOf(view.items)).toEqual(['g甲专辑', '0', '1', '2', 'g乙专辑', '3', '4', '-']);
    expect(view.rowOf(7)).toBe(-1);
    expect(new Set(view.items.map((item) => item.key)).size).toBe(view.items.length);
  });

  it('游程在重取：几何不变，行画骨架、组头标成待定，焦点的键照旧', () => {
    const settled = buildPlaylistView(input({ runs: TWO_GROUPS }));
    const view = buildPlaylistView(input({ runs: TWO_GROUPS, groupsLoading: true }));
    expect(view.items.map((item) => item.key)).toEqual(settled.items.map((item) => item.key));
    const head = view.items[0];
    const first = view.items[1];
    expect(head?.kind === 'group' && head.data.pending).toBe(true);
    expect(first?.kind === 'row' ? first.track : 'missing').toBeUndefined();
    expect(view.trackOf(0)?.title).toBe('曲目 0');
  });

  it('行增删重排之后游程先到：行号对不上的旧行画骨架，组头写组键；扁平态照旧显示旧行', () => {
    const moved = { currentAt: (at: number) => at >= 3 };
    const view = buildPlaylistView(input({ runs: TWO_GROUPS, ...moved }));
    const first = view.items[1];
    const head = view.items[0];
    expect(first?.kind === 'row' ? first.track : 'missing').toBeUndefined();
    expect(head?.kind === 'group' ? head.data.row : 'missing').toBeUndefined();
    const fourth = view.items[5];
    expect(fourth?.kind === 'row' ? fourth.track?.title : undefined).toBe('曲目 3');
    expect(view.trackOf(0)).toBeUndefined();
    const flat = buildPlaylistView(input(moved)).items[0];
    expect(flat?.kind === 'row' ? flat.track?.title : undefined).toBe('曲目 0');
  });

  it('分组开着、第一份游程还没到：先不画；降级了或没开分组就走扁平', () => {
    const waiting = buildPlaylistView(input({ grouping: true, groupsLoading: true }));
    expect(waiting.shape).toBe('waiting');
    expect(waiting.items).toEqual([]);
    expect(waiting.reachable()).toEqual([]);
    const failed = { grouping: true, groupsLoading: true, groupsFailed: true };
    expect(buildPlaylistView(input(failed)).shape).toBe('flat');
    expect(buildPlaylistView(input({ groupsLoading: true })).shape).toBe('flat');
  });
});

describe('过滤态', () => {
  const hits: PlaylistHit[] = [
    { index: 1, row: row(1, '命中 1') },
    { index: 4, row: row(4, '命中 4') },
  ];

  it('旁路分组：只出命中的行，行上带的仍是真实行号', () => {
    const view = buildPlaylistView(
      input({ grouping: true, runs: TWO_GROUPS, filter: { hits, stamp: 3 } }),
    );
    expect(view.shape).toBe('filtered');
    expect(shapeOf(view.items)).toEqual(['1', '4']);
    expect(view.rowOf(1)).toBe(4);
    expect(view.displayOf(4)).toBe(1);
    expect(view.displayOf(2)).toBe(-1);
    expect(view.reachable()).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 5 },
    ]);
  });

  it('游程在重取不挡过滤；行对象与评分戳取命中快照里的', () => {
    const view = buildPlaylistView(
      input({
        runs: TWO_GROUPS,
        groupsLoading: true,
        rowAt: () => undefined,
        filter: { hits, stamp: 3 },
      }),
    );
    const first = view.items[0];
    if (first?.kind !== 'row') throw new Error('第一条应是命中的行');
    expect(first.track?.title).toBe('命中 1');
    expect(view.stampOf(first)).toBe(3);
    expect(view.trackOf(4)?.title).toBe('命中 4');
    expect(view.trackOf(0)).toBeUndefined();
  });
});
