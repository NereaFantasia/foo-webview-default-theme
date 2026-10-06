import { describe, expect, it } from 'vitest';
import { dropdownPanelHeight } from '../../../../../src/library/album-wall/albumDropdown.ts';
import {
  buildGridItems,
  type GridItem,
} from '../../../../../src/library/album-wall/albumGridLayout.ts';
import type { Album } from '../../../../../src/host/libraryContract.ts';
import type { FoldFrame } from '../../../../../src/library/album-wall/dropdown/foldClock.ts';
import {
  WallFold,
  type WallFoldHost,
} from '../../../../../src/library/album-wall/dropdown/wallFold.ts';
import { FOLD_CLOSE, FOLD_OPEN, FOLD_RESIZE } from '../../../../../src/motion/foldMotion.ts';
import { albumRow } from '../../../../fixtures/libraryRows.ts';

// 十张专辑平铺、一行两块：五行，行高 200，节头不出。视口 600、上下内边距共 16。
// 首数 10 的面板高 340（不矮于封面边长），在条目流里占 352（加行间距 12）。
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const ALBUMS = NAMES.map((name) => albumRow(name, 'X'));
const PANEL = dropdownPanelHeight(10);
const GAP = 12;

function album(name: string): Album {
  const found = ALBUMS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(name);
  return found;
}

/** 替身宿主：时钟、逐帧回调与取曲目都由测试推进；画出去的每一帧都记下。 */
function harness(
  options: { reduced?: boolean; perRow?: number; counts?: [string, number][] } = {},
) {
  let now = 1000;
  let scrollTop = 0;
  let frames: (() => void)[] = [];
  const painted: FoldFrame[] = [];
  const loads = new Map<string, (count: number | null) => void>();
  /** 曲目表里已有的首数，按专辑名；没有的按专辑行记的。 */
  const counts = new Map<string, number>(options.counts ?? []);
  let changes = 0;
  const items: GridItem[] = buildGridItems(
    [{ key: null, albums: ALBUMS }],
    new Set(),
    options.perRow ?? 2,
    { headers: false, repeats: false },
  );
  const host: WallFoldHost = {
    geometry: () => ({
      items,
      rowHeight: 200,
      headerHeight: 32,
      gap: GAP,
      scrollTop,
      viewport: 600,
      padding: 16,
    }),
    scrollTop: () => scrollTop,
    scrollTo: (top) => {
      scrollTop = top;
    },
    paint: (frame) => painted.push(frame),
    changed: () => {
      changes += 1;
    },
    load: (loaded) => new Promise((resolve) => loads.set(loaded.name, resolve)),
    countOf: (shown) => counts.get(shown.name) ?? shown.trackCount,
    reduced: () => options.reduced ?? false,
    now: () => now,
    frame: (callback) => {
      frames.push(callback);
      return () => {
        frames = frames.filter((pending) => pending !== callback);
      };
    },
  };
  const fold = new WallFold(host);
  const last = () => painted[painted.length - 1];
  return {
    fold,
    /** 渲染层提交了：结构变了就按新结构起步。 */
    commit: () => fold.committed(),
    /** 走 `ms` 毫秒再跑一帧；结构变了先提交再走。 */
    advance(ms: number) {
      now += ms;
      const pending = frames;
      frames = [];
      for (const callback of pending) callback();
      fold.committed();
    },
    visible: (id: number) => last()?.visible.get(id),
    shifts: () => last()?.shifts ?? [],
    /** 到此为止画出去的每一帧。 */
    painted: () => painted.slice(),
    ids: () => fold.snapshot().placements.map((placement) => placement.album.name),
    idOf: (name: string) =>
      fold.snapshot().views.find((view) => view.album.name === name)?.id ?? -1,
    answer: async (name: string, count: number | null) => {
      loads.get(name)?.(count);
      await Promise.resolve();
      await Promise.resolve();
    },
    scroll: () => scrollTop,
    setScroll: (top: number) => {
      scrollTop = top;
    },
    changes: () => changes,
  };
}

describe('开合', () => {
  it('单击一张：插一条下拉，提交后从 0 露出，下面的元素从旧位置平移，333 ms 到位', () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    expect(h.ids()).toEqual(['A']);
    expect(h.fold.snapshot().placements[0]?.panel).toBe(PANEL);
    h.commit();
    const id = h.idOf('A');
    // 下面的元素还在展开之前的位置：条目流里给下拉留的面板高与行间距，一起往回挪。
    expect(h.visible(id)).toBe(0);
    expect(h.shifts()).toEqual([-(PANEL + GAP)]);
    h.advance(FOLD_OPEN.duration / 2);
    // 展开曲线先快后慢，走到一半时间已露出过半。
    expect(h.visible(id)).toBeGreaterThan(PANEL / 2);
    expect(h.visible(id)).toBeLessThan(PANEL);
    h.advance(FOLD_OPEN.duration / 2);
    expect(h.visible(id)).toBe(PANEL);
    expect(h.shifts()).toEqual([0]);
  });

  it('再点同一张收起：167 ms 收完才移出条目流', () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    const id = h.idOf('A');
    h.advance(FOLD_OPEN.duration);
    h.fold.toggle(album('A'), null);
    h.commit();
    expect(h.fold.snapshot().views[0]?.closing).toBe(true);
    h.advance(FOLD_CLOSE.duration - 1);
    expect(h.ids()).toEqual(['A']);
    h.advance(1);
    expect(h.ids()).toEqual([]);
    expect(h.fold.current()).toBeNull();
    // 收到 0 的那一帧，下面的元素已挪回移出之后的位置，移出条目流时不跳。
    const closed = h.painted().filter((frame) => frame.visible.get(id) === 0);
    expect(closed.at(-1)?.shifts).toEqual([-(PANEL + GAP)]);
  });

  it('展开到一半再点：从当前位置反向，剩下的时长按已走的比例缩短', () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    const id = h.idOf('A');
    h.advance(40);
    const reached = h.visible(id) ?? 0;
    h.fold.toggle(album('A'), null);
    h.commit();
    expect(h.visible(id)).toBeCloseTo(reached);
    const back = FOLD_CLOSE.duration * (reached / PANEL);
    h.advance(back - 2);
    expect(h.ids()).toEqual(['A']);
    h.advance(2);
    expect(h.ids()).toEqual([]);
  });

  it('✕ 与 Esc 收起开着的那条；当场撤掉不播动画', () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    h.fold.close();
    expect(h.fold.snapshot().views[0]?.closing).toBe(true);
    h.fold.dismiss();
    h.commit();
    expect(h.ids()).toEqual([]);
    expect(h.shifts()).toEqual([]);
  });

  it('减弱动效：提交后第一帧就到位', () => {
    const h = harness({ reduced: true });
    h.fold.toggle(album('A'), null);
    h.commit();
    expect(h.visible(h.idOf('A'))).toBe(PANEL);
  });
});

describe('换一张', () => {
  it('同一行换一张：不收起，等它的曲目到了才换内容；高不变，不起补间', async () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    h.advance(FOLD_OPEN.duration);
    const id = h.idOf('A');
    h.fold.toggle(album('B'), null);
    expect(h.fold.snapshot().views).toMatchObject([{ id, album: album('A'), waiting: album('B') }]);
    await h.answer('B', 20);
    const [view] = h.fold.snapshot().views;
    expect(view).toMatchObject({ id, album: album('B'), waiting: null, moving: false });
    expect(view?.panel).toBe(PANEL);
    h.commit();
    expect(h.visible(id)).toBe(PANEL);
  });

  it('同一行换一张时面板有一截在视口外：只换内容，不为露出它去滚视口', async () => {
    const h = harness();
    h.fold.toggle(album('E'), null);
    h.commit();
    h.advance(FOLD_OPEN.duration);
    h.setScroll(0);
    h.fold.toggle(album('F'), null);
    await h.answer('F', 2);
    h.commit();
    h.advance(FOLD_RESIZE.duration);
    expect(h.fold.snapshot().views[0]?.album).toEqual(album('F'));
    expect(h.scroll()).toBe(0);
  });

  it('连点只认最后一次：先点的那张晚到的曲目不换上去', async () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    h.fold.toggle(album('B'), null);
    h.fold.toggle(album('A'), null);
    await h.answer('B', 20);
    expect(h.fold.snapshot().views[0]).toMatchObject({ album: album('A'), waiting: album('A') });
    await h.answer('A', 10);
    expect(h.fold.snapshot().views[0]).toMatchObject({ album: album('A'), waiting: null });
  });

  it('换到别的行：旧的收起与新的展开同时走，旧的收完移出', () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    h.advance(FOLD_OPEN.duration);
    h.fold.toggle(album('E'), null);
    expect(h.ids()).toEqual(['E', 'A']);
    h.commit();
    const [a, e] = [h.idOf('A'), h.idOf('E')];
    expect(h.visible(a)).toBe(PANEL);
    expect(h.visible(e)).toBe(0);
    h.advance(FOLD_CLOSE.duration);
    expect(h.ids()).toEqual(['E']);
    expect(h.visible(e)).toBeGreaterThan(0);
  });

  it('首数与专辑行记的不同：还在展开就改道接着展开到新高', async () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    h.advance(50);
    await h.answer('A', 30);
    expect(h.fold.snapshot().views[0]?.panel).toBe(dropdownPanelHeight(30));
    h.commit();
    h.advance(FOLD_OPEN.duration);
    expect(h.visible(h.idOf('A'))).toBe(dropdownPanelHeight(30));
  });
});

describe('滚动', () => {
  it('放不下：视口与展开同步滚到下拉底边连同行间距贴视口底边', () => {
    const h = harness();
    h.fold.toggle(album('E'), null);
    h.commit();
    // E 在第三行（上沿 400），下拉 600 到 940，再加行间距贴 600 高的视口底边：352。
    h.advance(FOLD_OPEN.duration / 2);
    expect(h.scroll()).toBeGreaterThan(0);
    expect(h.scroll()).toBeLessThan(352);
    h.advance(FOLD_OPEN.duration / 2);
    expect(h.scroll()).toBe(352);
  });

  it('用户自己滚了：自动滚动就此停下', () => {
    const h = harness();
    h.fold.toggle(album('E'), null);
    h.commit();
    h.advance(50);
    h.setScroll(10);
    h.advance(50);
    h.advance(FOLD_OPEN.duration);
    expect(h.scroll()).toBe(10);
  });

  it('收起时不滚回去；只在内容变短、视口被迫上移时跟着收起的时间线走', () => {
    const h = harness();
    h.fold.toggle(album('J'), null);
    h.commit();
    h.advance(FOLD_OPEN.duration);
    expect(h.scroll()).toBe(752);
    h.fold.toggle(album('J'), null);
    h.commit();
    h.advance(FOLD_CLOSE.duration / 2);
    expect(h.scroll()).toBeLessThan(752);
    expect(h.scroll()).toBeGreaterThan(416);
    h.advance(FOLD_CLOSE.duration / 2);
    // 收完总高 1000 加内边距 16，视口 600：最低处 416。
    expect(h.scroll()).toBe(416);
  });

  it('换行时旧的那条整个在视口上面：当场撤掉，视口同步上移，被点的那一行不跟着跑', () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    h.advance(FOLD_OPEN.duration);
    h.setScroll(600);
    h.fold.toggle(album('G'), null);
    expect(h.ids()).toEqual(['G']);
    h.commit();
    expect(h.scroll()).toBe(600 - (PANEL + GAP));
  });

  it('直接开到位：不播动画、不自动滚，曲目到了改高也不滚', async () => {
    const h = harness();
    h.fold.restore(album('J'), null);
    h.commit();
    expect(h.visible(h.idOf('J'))).toBe(PANEL);
    expect(h.scroll()).toBe(0);
    await h.answer('J', 30);
    h.commit();
    h.advance(FOLD_RESIZE.duration);
    expect(h.visible(h.idOf('J'))).toBe(dropdownPanelHeight(30));
    expect(h.scroll()).toBe(0);
  });
});

describe('条目流', () => {
  it('开着的那条排在最前；动画中的面板高之和给虚拟滚动多画几行，停下后归零', () => {
    const h = harness();
    h.fold.toggle(album('A'), null);
    h.commit();
    h.advance(FOLD_OPEN.duration);
    h.fold.toggle(album('E'), null);
    expect(h.fold.snapshot().placements.map((placement) => placement.album.name)).toEqual([
      'E',
      'A',
    ]);
    expect(h.fold.snapshot().reach).toBe(2 * PANEL);
    h.commit();
    h.advance(FOLD_OPEN.duration);
    expect(h.fold.snapshot().reach).toBe(0);
  });

  it('结构不变时快照是同一个对象；变了就换一个并叫渲染层重画', () => {
    const h = harness();
    const before = h.changes();
    const empty = h.fold.snapshot();
    expect(h.fold.snapshot()).toBe(empty);
    h.fold.toggle(album('A'), null);
    expect(h.changes()).toBeGreaterThan(before);
    expect(h.fold.snapshot()).not.toBe(empty);
  });
});

describe('面板高', () => {
  it('曲目表里已有这张的首数就按它算，不先按专辑行记的首数长再改高', () => {
    const h = harness({ counts: [['A', 2]] });
    h.fold.restore(album('A'), null);
    expect(h.fold.snapshot().placements[0]?.panel).toBe(dropdownPanelHeight(2));
    h.fold.toggle(album('E'), null);
    expect(h.fold.snapshot().placements[0]?.panel).toBe(PANEL);
  });
});
