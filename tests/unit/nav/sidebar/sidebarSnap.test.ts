import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_LINE,
  EXPAND_LINE,
  KEY_STEP,
  snapDrag,
  snapKey,
  toggleShape,
  type SidebarShape,
} from '../../../../src/nav/sidebar/sidebarSnap.ts';

const BOUNDS = { min: 200, max: 360 };
const expanded = (width: number): SidebarShape => ({ rail: false, width });
const rail = (width: number): SidebarShape => ({ rail: true, width });

/** 按一串指针位置逐次吸附，像拖动时一个个 pointermove 那样。 */
function dragThrough(start: SidebarShape, pointers: readonly number[]): SidebarShape[] {
  const shapes: SidebarShape[] = [];
  let shape = start;
  for (const pointer of pointers) {
    shape = snapDrag(pointer, shape, BOUNDS, start.width);
    shapes.push(shape);
  }
  return shapes;
}

describe('snapDrag', () => {
  it('展开态往左拖：过了 200 停住，过了收起线立刻吸成图标态，留下拖动之前的宽度', () => {
    const shapes = dragThrough(expanded(300), [280, 200, 150, COLLAPSE_LINE, COLLAPSE_LINE - 1]);
    expect(shapes).toEqual([expanded(280), expanded(200), expanded(200), expanded(200), rail(300)]);
  });

  it('图标态往右拖：过了展开线立刻展开到 200，之后跟手，过了 360 停住', () => {
    const shapes = dragThrough(rail(280), [100, EXPAND_LINE, EXPAND_LINE + 1, 250, 400]);
    expect(shapes).toEqual([rail(280), rail(280), expanded(200), expanded(250), expanded(360)]);
  });

  it('116–132 是滞回带：指针在带里来回，形态不变', () => {
    const band = [COLLAPSE_LINE + 1, EXPAND_LINE - 1, COLLAPSE_LINE + 4, EXPAND_LINE];
    expect(dragThrough(rail(260), band).every((shape) => shape.rail)).toBe(true);
    expect(dragThrough(expanded(260), band).every((shape) => !shape.rail)).toBe(true);
  });

  it('同一次拖动里先吸成图标态再拖回来：从 200 起跟手，再收起时还留拖动之前的宽度', () => {
    const shapes = dragThrough(expanded(320), [100, 140, 230, 90]);
    expect(shapes).toEqual([rail(320), expanded(200), expanded(230), rail(320)]);
  });

  it('宽度取整；上限比下限还小时以下限为准', () => {
    expect(snapDrag(250.6, expanded(260), BOUNDS, 260)).toEqual(expanded(251));
    expect(snapDrag(300, expanded(260), { min: 200, max: 150 }, 260)).toEqual(expanded(200));
  });
});

describe('snapKey', () => {
  it('← / → 每步 16，夹在上下限之间', () => {
    expect(snapKey('ArrowLeft', expanded(260), BOUNDS)).toEqual(expanded(260 - KEY_STEP));
    expect(snapKey('ArrowRight', expanded(260), BOUNDS)).toEqual(expanded(260 + KEY_STEP));
    expect(snapKey('ArrowLeft', expanded(210), BOUNDS)).toEqual(expanded(200));
    expect(snapKey('ArrowRight', expanded(350), BOUNDS)).toEqual(expanded(360));
  });

  it('在 200 再按 ← 进图标态；图标态按 → 回到 200，再按 ← 不动', () => {
    expect(snapKey('ArrowLeft', expanded(200), BOUNDS)).toEqual(rail(200));
    expect(snapKey('ArrowRight', rail(300), BOUNDS)).toEqual(expanded(200));
    expect(snapKey('ArrowLeft', rail(300), BOUNDS)).toEqual(rail(300));
  });

  it('Home 到图标态、End 到 360、Enter 切换；别的键不认', () => {
    expect(snapKey('Home', expanded(280), BOUNDS)).toEqual(rail(280));
    expect(snapKey('End', rail(280), BOUNDS)).toEqual(expanded(360));
    expect(snapKey('Enter', rail(280), BOUNDS)).toEqual(expanded(280));
    expect(snapKey('Enter', expanded(280), BOUNDS)).toEqual(rail(280));
    expect(snapKey('ArrowUp', expanded(280), BOUNDS)).toBeNull();
  });
});

describe('toggleShape', () => {
  it('在图标态与上次的展开宽度之间切换', () => {
    expect(toggleShape(expanded(300))).toEqual(rail(300));
    expect(toggleShape(rail(300))).toEqual(expanded(300));
  });
});
