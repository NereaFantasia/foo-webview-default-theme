import { CURVE, DURATION_MS } from '../../motion/timing.ts';
import { flowItemSize, itemTops, rowHolding } from './albumDropdown.ts';
import type { GridItem, PlacedTile } from './albumGridLayout.ts';
import { albumKeyOf } from '../../host/libraryContract.ts';

// 封面墙换列时的位移。行层里的图块、节头与下拉各自按位置键记下上一次提交的位置；列数一变，在新位置上
// 叠一段从旧位置回到 0 的位移（`composite: 'add'`，加在元素自己定位用的 transform 上）。所以元素的
// 定位在第 0 帧就到终值，之后宽度再怎么变都当场跟上，叠着的那段位移只管自己收回去；动画中又换列，
// 新的一段接着叠上，不必读出上一段播到哪。

/** 行层里跟着换列移动的元素带这个属性，值是它的位置键。 */
export const REFLOW_KEY_ATTR = 'data-reflow-key';
/** 跟着某一块走、自己不算一个位置的元素（悬停键）带这个属性，值是那一块的位置键。 */
export const REFLOW_FOLLOW_ATTR = 'data-reflow-follow';

/** 已在场元素滑到新位置：点到点，250 ms。 */
export const REFLOW_MOVE = { duration: DURATION_MS.normal, curve: CURVE.pointToPoint } as const;
/** 换列后才进到画出范围里、或挪得比一屏还远的元素，原地淡入：直接进场，167 ms。 */
export const REFLOW_ENTER = { duration: DURATION_MS.fast, curve: CURVE.decelerateMid } as const;

export const tileReflowKey = (tileKey: string) => `t:${tileKey}`;
export const headerReflowKey = (sectionKey: string | null) =>
  sectionKey === null ? 'h' : `h:${sectionKey}`;
export const dropdownReflowKey = (id: number) => `d:${id}`;

/** 行层坐标里的左上角，CSS 像素。 */
export interface ReflowPlace {
  readonly x: number;
  readonly y: number;
}

/** 此刻画出来的各元素的位置：图块按自己的坐标，节头贴左，下拉与图块行同一个起点。 */
export function reflowPlaces(
  items: readonly GridItem[],
  rows: readonly { readonly index: number; readonly start: number }[],
  tiles: readonly PlacedTile[],
  rowOffset: number,
): Map<string, ReflowPlace> {
  const places = new Map<string, ReflowPlace>();
  for (const tile of tiles) places.set(tileReflowKey(tile.key), { x: tile.x, y: tile.y });
  for (const row of rows) {
    const item = items[row.index];
    if (item?.kind === 'header') {
      places.set(headerReflowKey(item.section.key), { x: 0, y: row.start });
    } else if (item?.kind === 'dropdown') {
      places.set(dropdownReflowKey(item.id), { x: Math.round(rowOffset), y: row.start });
    }
  }
  return places;
}

/** 算条目上沿要的：条目流与图块行、节头的高。 */
export interface FlowShape {
  readonly items: readonly GridItem[];
  readonly rowHeight: number;
  readonly headerHeight: number;
}

function topsOf(shape: FlowShape): number[] {
  return itemTops(shape.items, (item) => flowItemSize(item, shape.rowHeight, shape.headerHeight));
}

/**
 * 换列之后视口该在哪：换列前压着视口顶边的那一行图块（节头与下拉往下找到第一行），取它的第一张专辑，
 * 换列后让这张所在的行离视口顶边还是原来那么远。深处换列时视口里还是那几张，图块才滑得起来，不整屏
 * 换人。滚动在最顶上、或换列后找不到那张时不动。
 */
export function anchoredScrollTop(before: FlowShape, after: FlowShape, scrollTop: number): number {
  if (!(scrollTop > 0)) return scrollTop;
  const tops = topsOf(before);
  for (const [index, item] of before.items.entries()) {
    if (item.kind !== 'row' || (tops[index + 1] ?? 0) <= scrollTop) continue;
    const album = item.albums[0];
    const hit = album && rowHolding(after.items, albumKeyOf(album), item.sectionKey);
    if (!hit) return scrollTop;
    const offset = (tops[index] ?? 0) - scrollTop;
    return Math.max(0, (topsOf(after)[hit.index] ?? 0) - offset);
  }
  return scrollTop;
}

/** 撤掉叠在元素上的换列位移：跟着走的元素换了跟随对象，上一块剩下的那段位移不该带到新的一块上。 */
export function dropReflow(element: Element): void {
  for (const animation of element.getAnimations()) {
    if (animation.effect instanceof KeyframeEffect && animation.effect.composite === 'add') {
      animation.cancel();
    }
  }
}

/** 行层里的一个元素；`HTMLElement` 就是。 */
export interface ReflowElement {
  readonly dataset: DOMStringMap;
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): unknown;
}

export interface ReflowCommit {
  /** 此刻的列数；0 是还没量出宽度，从 0 到第一个列数是初始布局，不算换列。 */
  readonly columns: number;
  /** 各位置键此刻的位置。 */
  readonly places: ReadonlyMap<string, ReflowPlace>;
  /** 换列时播不播：减弱动效、侧边栏换形态挤出来的换列都不播，直接到位。 */
  readonly animate: boolean;
  /**
   * 只在换列且要播时才调：读滚动容器要逼浏览器当场重算样式与布局，拖窗口时每一步都读的话，每一步都多
   * 一次同步重排。
   */
  readonly viewport: () => ReflowViewport;
}

export interface ReflowViewport {
  /** 这次提交里滚动往下挪了多少（换列时的锚定与内容变短时浏览器的夹取），CSS 像素。 */
  readonly scrolled: number;
  /** 视口高，CSS 像素：换列前后在视口里挪得比它还远的，不滑、原地淡入。 */
  readonly reach: number;
}

export interface WallReflow {
  /** 每次提交后在布局阶段调；只在换列时才去取 `elements`。 */
  commit(elements: () => Iterable<ReflowElement>, next: ReflowCommit): void;
}

export function createWallReflow(): WallReflow {
  let columns = 0;
  let places: ReadonlyMap<string, ReflowPlace> = new Map();

  function slide(element: ReflowElement, dx: number, dy: number): void {
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      {
        duration: REFLOW_MOVE.duration,
        easing: REFLOW_MOVE.curve.timing,
        composite: 'add',
      },
    );
  }

  function enter(element: ReflowElement): void {
    element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: REFLOW_ENTER.duration,
      easing: REFLOW_ENTER.curve.timing,
    });
  }

  return {
    commit(elements, next) {
      const before = places;
      const changed = columns > 0 && next.columns > 0 && next.columns !== columns;
      columns = next.columns;
      places = next.places;
      if (!changed || !next.animate) return;
      const { scrolled, reach } = next.viewport();
      for (const element of elements()) {
        const key = element.dataset['reflowKey'] ?? element.dataset['reflowFollow'];
        const to = key === undefined ? undefined : next.places.get(key);
        if (!key || !to) continue;
        const from = before.get(key);
        // 视口里的位置不变：旧位置减旧滚动等于新位置加位移减新滚动。
        const dx = from ? Math.round(from.x - to.x) : 0;
        const dy = from ? Math.round(from.y - to.y + scrolled) : 0;
        if (!from || Math.abs(dy) > reach) enter(element);
        else if (dx !== 0 || dy !== 0) slide(element, dx, dy);
      }
    },
  };
}
