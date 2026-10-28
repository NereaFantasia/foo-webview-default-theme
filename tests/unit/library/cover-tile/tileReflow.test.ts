import { describe, expect, it } from 'vitest';
import {
  createTileReflow,
  REFLOW_ENTER,
  REFLOW_MOVE,
  type ReflowCommit,
  type ReflowElement,
  type ReflowPlace,
} from '../../../../src/library/cover-tile/tileReflow.ts';

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

describe('createTileReflow', () => {
  it('换列时在新位置上叠一段从旧位置回到 0 的位移；初始布局与列数不变都不播、也不读视口', () => {
    viewportReads = 0;
    const reflow = createTileReflow();
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
    const reflow = createTileReflow();
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
    const reflow = createTileReflow();
    const keys = element({ reflowFollow: 't:a' });
    reflow.commit(() => [keys], commit(4, [['t:a', { x: 200, y: 0 }]]));
    reflow.commit(() => [keys], commit(5, [['t:a', { x: 0, y: 0 }]], { animate: false }));
    expect(keys.calls).toEqual([]);
    expect(viewportReads).toBe(0);
    reflow.commit(() => [keys], commit(4, [['t:a', { x: 200, y: 0 }]]));
    expect(keys.calls[0]?.keyframes[0]).toEqual({ transform: 'translate(-200px, 0px)' });
  });
});
