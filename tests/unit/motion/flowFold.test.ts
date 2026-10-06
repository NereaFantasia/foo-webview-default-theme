import { describe, expect, it, vi } from 'vitest';
import { FOLD_CLOSE, FOLD_OPEN } from '../../../src/motion/foldMotion.ts';
import {
  createFlowFold,
  followerShift,
  remainingMs,
  type FoldElement,
} from '../../../src/motion/flowFold.ts';

interface FakeAnimation {
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
  readonly finished: Promise<void>;
  currentTime: number | null;
  cancelled: boolean;
  cancel(): void;
  finish(): void;
}

function fakeAnimation(keyframes: Keyframe[], options: KeyframeAnimationOptions): FakeAnimation {
  let resolve = () => {};
  const finished = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    keyframes,
    options,
    finished,
    currentTime: null,
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
    finish: () => resolve(),
  };
}

interface FakeElement extends FoldElement {
  readonly styles: Map<string, string>;
  readonly animations: FakeAnimation[];
  readonly parts: FakeElement[];
}

interface Box {
  readonly top: number;
  readonly bottom: number;
}

function fakeElement(box: () => Box, parts: FakeElement[] = []): FakeElement {
  const styles = new Map<string, string>();
  const animations: FakeAnimation[] = [];
  return {
    inert: false,
    styles,
    animations,
    parts,
    style: {
      setProperty: (name, value) => {
        styles.set(name, value ?? '');
      },
      removeProperty: (name) => {
        const old = styles.get(name) ?? '';
        styles.delete(name);
        return old;
      },
    },
    animate(keyframes, options) {
      const animation = fakeAnimation(keyframes, options);
      animations.push(animation);
      return animation;
    },
    getBoundingClientRect() {
      const { top, bottom } = box();
      return { top, bottom, left: 0, width: 200, height: bottom - top };
    },
  };
}

const still = () => ({ top: 0, bottom: 0 });

/**
 * 一节内容高 100，两项，在标题下面（上沿 200）。脱离文档流（`position` 有值）时它落到这一节的顶上（150），
 * 下面三样上移 100：占满余量的一栏（上沿跟着内容挪，底边贴着 800 不动，里面一个子元素）、
 * 整体下移的一块、钉在底部不动的一行。
 */
function scene() {
  const items = [fakeElement(still), fakeElement(still)];
  let inFlow = () => true;
  const body = fakeElement(
    () => (inFlow() ? { top: 200, bottom: 300 } : { top: 150, bottom: 250 }),
    items,
  );
  inFlow = () => !body.styles.has('position');
  const offset = () => (inFlow() ? 100 : 0);
  const content = fakeElement(still);
  const fill = fakeElement(() => ({ top: 300 + offset(), bottom: 800 }), [content]);
  const block = fakeElement(() => ({ top: 800 + offset(), bottom: 850 + offset() }));
  const footer = fakeElement(() => ({ top: 1000, bottom: 1040 }));
  const onClosed = vi.fn();
  const make = (open: boolean, followers = [fill, block, footer]) =>
    createFlowFold<FakeElement>({
      open,
      body: () => body,
      followers: () => followers,
      parts: (element) => element.parts,
      onClosed,
    });
  return { body, items, fill, content, block, footer, onClosed, make };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function last(element: FakeElement): FakeAnimation {
  const animation = element.animations.at(-1);
  if (!animation) throw new Error('没有动画');
  return animation;
}

function finishAll(...elements: FakeElement[]): void {
  for (const element of elements) element.animations.at(-1)?.finish();
}

const at = (y: number) => ({ translate: `0 ${y}px` });

describe('followerShift', () => {
  it('整体下移的元素没被挤矮', () => {
    expect(followerShift({ top: 900, bottom: 950 }, { top: 800, bottom: 850 })).toEqual({
      shift: 100,
      squeeze: 0,
    });
  });

  it('底边不动的一栏被挤矮的就是挪下去的距离', () => {
    expect(followerShift({ top: 400, bottom: 800 }, { top: 300, bottom: 800 })).toEqual({
      shift: 100,
      squeeze: 100,
    });
  });
});

describe('remainingMs', () => {
  it('按还要走的比例缩短', () => {
    expect(remainingMs(250, 0.4, 1)).toBeCloseTo(150);
    expect(remainingMs(250, 1, 0)).toBe(250);
  });
});

describe('createFlowFold', () => {
  it('收起：内容钉在原位当裁剪框，里面的项往上藏；下面的元素同步补位，播完才通知卸掉', async () => {
    const { body, items, fill, content, block, footer, onClosed, make } = scene();
    const fold = make(true);
    fold.set(false, false);

    expect(body.inert).toBe(true);
    expect(body.styles.get('position')).toBe('absolute');
    expect(body.styles.get('overflow')).toBe('hidden');
    expect(body.styles.get('translate')).toBe('0px 50px');
    expect(body.styles.get('height')).toBe('100px');
    expect(body.animations).toHaveLength(0);
    for (const item of items) {
      expect(last(item).keyframes).toEqual([at(0), at(-100)]);
      expect(last(item).options).toMatchObject({
        duration: FOLD_CLOSE.duration,
        easing: FOLD_CLOSE.curve.timing,
      });
    }
    // 被挤矮的一栏自己不动、裁掉底部，里面的子元素位移；整体下移的一块自己位移。
    expect(fill.styles.get('overflow')).toBe('hidden');
    expect(fill.animations).toHaveLength(0);
    expect(last(content).keyframes).toEqual([at(100), at(0)]);
    expect(last(block).keyframes).toEqual([at(100), at(0)]);
    expect(block.styles.has('overflow')).toBe(false);
    expect(footer.animations).toHaveLength(0);
    expect(onClosed).not.toHaveBeenCalled();

    finishAll(...items, content, block);
    await settle();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(body.styles.get('visibility')).toBe('hidden');
    expect(fill.styles.has('overflow')).toBe(false);
    expect(last(content).cancelled).toBe(true);
  });

  it('展开：项从标题下面滑出，下面的元素同步让位，播完放回文档流', async () => {
    const { body, items, fill, content, block, onClosed, make } = scene();
    const fold = make(false);
    fold.set(true, false);

    expect(body.inert).toBe(false);
    expect(last(items[0] ?? body).keyframes).toEqual([at(-100), at(0)]);
    expect(last(items[0] ?? body).options).toMatchObject({
      duration: FOLD_OPEN.duration,
      easing: FOLD_OPEN.curve.timing,
    });
    expect(last(content).keyframes).toEqual([at(0), at(100)]);

    finishAll(...items, content, block);
    await settle();
    for (const property of ['position', 'overflow', 'translate', 'height']) {
      expect(body.styles.has(property)).toBe(false);
    }
    expect(fill.styles.has('overflow')).toBe(false);
    expect(last(content).cancelled).toBe(true);
    fold.set(true, false);
    expect(content.animations).toHaveLength(1);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('展开到一半收起：从当前位置往回走，时长按剩下的距离缩短', () => {
    const { body, items, fill, content, make } = scene();
    const fold = make(false, [fill]);
    fold.set(true, false);
    const [item] = items;
    if (!item) throw new Error('没有项');
    const opening = last(item);
    opening.currentTime = FOLD_OPEN.duration / 2;
    const progress = FOLD_OPEN.curve.ease(0.5);

    fold.set(false, false);
    expect(opening.cancelled).toBe(true);
    expect(last(item).keyframes).toEqual([at(-100 * (1 - progress)), at(-100)]);
    expect(last(item).options.duration).toBeCloseTo(FOLD_CLOSE.duration * progress);
    expect(last(content).keyframes).toEqual([at(100 * progress), at(0)]);
    expect(body.inert).toBe(true);
  });

  it('减弱动效：当场收起，照常通知一次', () => {
    const { items, content, onClosed, make } = scene();
    const fold = make(true);
    fold.set(false, true);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(items[0]?.animations).toHaveLength(0);
    expect(content.animations).toHaveLength(0);
    fold.set(false, true);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('播到一半卸掉：撤掉加在下面元素上的裁剪', () => {
    const { fill, make } = scene();
    const fold = make(true);
    fold.set(false, false);
    expect(fill.styles.get('overflow')).toBe('hidden');
    fold.dispose();
    expect(fill.styles.has('overflow')).toBe(false);
  });

  it('下面没有被挤动的元素：只有项自己滑回去', async () => {
    const { items, footer, onClosed, make } = scene();
    const fold = make(true, [footer]);
    fold.set(false, false);
    expect(footer.animations).toHaveLength(0);
    finishAll(...items);
    await settle();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
