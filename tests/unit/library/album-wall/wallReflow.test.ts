import { describe, expect, it } from 'vitest';
import { withDropdowns } from '../../../../src/library/album-wall/albumDropdown.ts';
import {
  buildGridItems,
  type GridItem,
} from '../../../../src/library/album-wall/albumGridLayout.ts';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import {
  anchoredScrollTop,
  createWallReflow,
  REFLOW_ENTER,
  REFLOW_MOVE,
  reflowPlaces,
  tileReflowKey,
  type ReflowCommit,
  type ReflowElement,
  type ReflowPlace,
} from '../../../../src/library/album-wall/wallReflow.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

// 二十张专辑一节、带节头：节头高 40，图块行高 100。

const ALBUMS = Array.from({ length: 20 }, (_, index) => albumRow(`A${index}`, 'X'));
const SECTION = [{ key: 'x', albums: ALBUMS }];

function shape(perRow: number, items?: GridItem[]) {
  return {
    items: items ?? buildGridItems(SECTION, new Set(), perRow, { headers: true, repeats: false }),
    rowHeight: 100,
    headerHeight: 40,
  };
}

describe('anchoredScrollTop', () => {
  it('压着视口顶边的那一行的第一张换列后离顶边还是那么远', () => {
    // 四列时 A8 在第三行，上沿 40 + 200；滚到 250，它那一行离顶边 -10。五列时 A8 在第二行，上沿 140。
    expect(anchoredScrollTop(shape(4), shape(5), 250)).toBe(150);
    // 反过来：五列滚到 150，压着顶边的是 A5 那一行（上沿 140，离顶边 -10）；四列时 A5 在第二行。
    expect(anchoredScrollTop(shape(5), shape(4), 150)).toBe(150);
  });

  it('滚动在最顶上不动；顶边压着节头时锚第一行图块', () => {
    expect(anchoredScrollTop(shape(4), shape(5), 0)).toBe(0);
    // 滚到 20，顶边压着节头，往下第一行是 A0 那一行，上沿 40、离顶边 20：换列后还在 40。
    expect(anchoredScrollTop(shape(4), shape(5), 20)).toBe(20);
  });

  it('换列后找不到那张：不动', () => {
    expect(anchoredScrollTop(shape(4), shape(5, []), 250)).toBe(250);
  });
});

interface FakeElement extends ReflowElement {
  readonly calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[];
}

function element(data: Record<string, string>): FakeElement {
  const calls: FakeElement['calls'] = [];
  return {
    dataset: data,
    calls,
    animate(keyframes, options) {
      calls.push({ keyframes, options });
      return undefined;
    },
  };
}

/** 读视口的次数：只在换列且要播时才该读。 */
let viewportReads = 0;

function commit(
  columns: number,
  places: [string, ReflowPlace][],
  extra: Partial<Omit<ReflowCommit, 'viewport'>> & { scrolled?: number } = {},
): ReflowCommit {
  const { scrolled = 0, ...rest } = extra;
  return {
    columns,
    places: new Map(places),
    animate: true,
    viewport: () => {
      viewportReads += 1;
      return { scrolled, reach: 600 };
    },
    ...rest,
  };
}

describe('createWallReflow', () => {
  it('换列时在新位置上叠一段从旧位置回到 0 的位移；初始布局与列数不变都不播、也不读视口', () => {
    viewportReads = 0;
    const reflow = createWallReflow();
    const tile = element({ reflowKey: 't:a' });
    const elements = () => [tile];
    reflow.commit(elements, commit(0, [['t:a', { x: 0, y: 0 }]]));
    reflow.commit(elements, commit(4, [['t:a', { x: 200, y: 0 }]]));
    reflow.commit(elements, commit(4, [['t:a', { x: 210, y: 0 }]]));
    expect(tile.calls).toEqual([]);
    expect(viewportReads).toBe(0);
    reflow.commit(elements, commit(5, [['t:a', { x: 20, y: 100 }]]));
    expect(viewportReads).toBe(1);
    expect(tile.calls).toEqual([
      {
        keyframes: [{ transform: 'translate(190px, -100px)' }, { transform: 'translate(0, 0)' }],
        options: {
          duration: REFLOW_MOVE.duration,
          easing: REFLOW_MOVE.curve.timing,
          composite: 'add',
        },
      },
    ]);
  });

  it('视口跟着锚定挪了：位移按视口里的位置算；挪得比一屏还远、或刚画出来的原地淡入', () => {
    const reflow = createWallReflow();
    const near = element({ reflowKey: 't:near' });
    const far = element({ reflowKey: 't:far' });
    const fresh = element({ reflowKey: 't:new' });
    reflow.commit(
      () => [],
      commit(4, [
        ['t:near', { x: 0, y: 1000 }],
        ['t:far', { x: 0, y: 200 }],
      ]),
    );
    reflow.commit(
      () => [near, far, fresh],
      commit(
        5,
        [
          ['t:near', { x: 0, y: 700 }],
          ['t:far', { x: 0, y: 1500 }],
          ['t:new', { x: 0, y: 800 }],
        ],
        { scrolled: -250 },
      ),
    );
    expect(near.calls[0]?.keyframes[0]).toEqual({ transform: 'translate(0px, 50px)' });
    for (const faded of [far, fresh]) {
      expect(faded.calls).toEqual([
        {
          keyframes: [{ opacity: 0 }, { opacity: 1 }],
          options: { duration: REFLOW_ENTER.duration, easing: REFLOW_ENTER.curve.timing },
        },
      ]);
    }
  });

  it('跟着一块走的元素照那一块的位移；不播时一个都不动、也不读视口', () => {
    viewportReads = 0;
    const reflow = createWallReflow();
    const keys = element({ reflowFollow: 't:a' });
    reflow.commit(() => [keys], commit(4, [['t:a', { x: 200, y: 0 }]]));
    reflow.commit(() => [keys], commit(5, [['t:a', { x: 0, y: 0 }]], { animate: false }));
    expect(keys.calls).toEqual([]);
    expect(viewportReads).toBe(0);
    reflow.commit(() => [keys], commit(4, [['t:a', { x: 200, y: 0 }]]));
    expect(keys.calls[0]?.keyframes[0]).toEqual({ transform: 'translate(-200px, 0px)' });
  });
});

describe('reflowPlaces', () => {
  it('图块按自己的坐标，节头贴左，下拉与图块行同一个起点', () => {
    const first = ALBUMS[0] ?? albumRow('?', '?');
    const items = withDropdowns(
      buildGridItems(SECTION, new Set(), 4, { headers: true, repeats: false }),
      [{ id: 7, album: first, sectionKey: 'x', panel: 340 }],
      12,
    );
    const places = reflowPlaces(
      items,
      [
        { index: 0, start: 0 },
        { index: 1, start: 40 },
        { index: 2, start: 140 },
      ],
      [
        {
          key: 'k',
          albumKey: albumKeyOf(first),
          sectionKey: 'x',
          album: first,
          index: 1,
          column: 0,
          x: 12,
          y: 40,
        },
      ],
      12.4,
    );
    expect([...places]).toEqual([
      [tileReflowKey('k'), { x: 12, y: 40 }],
      ['h:x', { x: 0, y: 0 }],
      ['d:7', { x: 12, y: 140 }],
    ]);
  });
});
