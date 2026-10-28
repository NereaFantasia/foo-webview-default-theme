import { describe, expect, it } from 'vitest';
import {
  createCoverflowEngine,
  type CardElement,
  type EngineCard,
  type EngineClock,
} from '../../../../src/immersive/coverflow/engine.ts';
import {
  ENTRY_DELAY_MS,
  EXIT_MS,
  REDUCED_FADE_MS,
  entryEnd,
} from '../../../../src/immersive/coverflow/entrance.ts';
import { MAX_GLIDE_MS } from '../../../../src/immersive/coverflow/glide.ts';
import { slotAt } from '../../../../src/immersive/coverflow/slots.ts';

const GEOMETRY = { width: 1280, cover: 320, spread: 1, perspective: 900 };

function fakeClock() {
  let time = 0;
  let pending: (() => void) | null = null;
  const clock: EngineClock = {
    now: () => time,
    frame(callback) {
      pending = callback;
      return () => {
        if (pending === callback) pending = null;
      };
    },
  };
  return {
    clock,
    hasFrame: () => pending !== null,
    /** 按 16 ms 一帧往前走 `ms` */
    advance(ms: number) {
      let left = ms;
      while (left > 0) {
        const step = Math.min(16, left);
        time += step;
        left -= step;
        const callback = pending;
        pending = null;
        callback?.();
      }
    },
  };
}

interface FakeCard extends CardElement {
  readonly vars: Record<string, string>;
}

function fakeElement(): FakeCard {
  const vars: Record<string, string> = {};
  return {
    vars,
    dataset: {},
    style: {
      transform: '',
      opacity: '',
      visibility: '',
      zIndex: '',
      setProperty(name, value) {
        vars[name] = value;
      },
    },
  };
}

function setup(count: number, options: { onSettle?: () => void } = {}) {
  const time = fakeClock();
  const engine = createCoverflowEngine(time.clock, options);
  const elements = Array.from({ length: count }, fakeElement);
  const cards: EngineCard[] = elements.map((element, index) => ({
    key: `k${index}`,
    index,
    element,
    current: index === Math.floor(count / 2),
  }));
  engine.setGeometry(GEOMETRY);
  engine.setCards(cards);
  return { ...time, engine, elements, cards };
}

const offsetOf = (element: CardElement) =>
  Number(/translateX\((-?[\d.e+-]+)px\)/.exec(element.style.transform)?.[1]);
const opacityOf = (element: CardElement) => Number(element.style.opacity);
const tilted = (element: CardElement) => element.style.transform.includes('perspective');

describe('paint：按槽位写样式', () => {
  it('选中项是平的、在中线、满不透明；两侧倾斜、位置按封面边长折算', () => {
    const { engine, elements } = setup(5);
    engine.jumpTo(2);
    engine.paint();
    expect(elements[2]?.style.transform).toBe('translateX(0px) scale(1)');
    expect(opacityOf(elements[2] as CardElement)).toBe(1);
    for (const [index, element] of elements.entries()) {
      if (index === 2) continue;
      const pose = slotAt(index - 2);
      expect(offsetOf(element)).toBeCloseTo(pose.offset * 320, 6);
      expect(tilted(element)).toBe(true);
      expect(element.style.transform).toContain(`rotateY(${pose.tilt}deg)`);
      expect(element.style.transform).toContain('perspective(900px)');
      expect(opacityOf(element)).toBeCloseTo(pose.opacity, 6);
    }
  });

  it('左边的卡标左、右边的标右，离选中项近的叠在上面', () => {
    const { engine, elements } = setup(5);
    engine.jumpTo(2);
    engine.paint();
    expect(elements[0]?.dataset.side).toBe('left');
    expect(elements[4]?.dataset.side).toBe('right');
    const z = (index: number) => Number(elements[index]?.style.zIndex);
    expect(z(2)).toBeGreaterThan(z(1));
    expect(z(1)).toBeGreaterThan(z(0));
    expect(elements[1]?.vars['--center']).toBe('0');
    expect(elements[2]?.vars['--center']).toBe('1');
  });

  it('离选中项 4 以上的不显示', () => {
    const { engine, elements } = setup(9);
    engine.jumpTo(0);
    engine.paint();
    expect(elements[3]?.style.visibility).toBe('visible');
    expect(elements[4]?.style.visibility).toBe('hidden');
    expect(elements[8]?.style.visibility).toBe('hidden');
  });

  it('封面边长变了，位置跟着等比', () => {
    const { engine, elements } = setup(3);
    engine.jumpTo(1);
    engine.setGeometry({ width: 800, cover: 160, spread: 1, perspective: 450 });
    engine.paint();
    expect(offsetOf(elements[2] as CardElement)).toBeCloseTo(0.9375 * 160, 6);
    expect(elements[2]?.style.transform).toContain('perspective(450px)');
  });

  it('间距收紧系数乘在槽位的偏移上，大小与倾角不变', () => {
    const { engine, elements } = setup(3);
    engine.jumpTo(1);
    engine.setGeometry({ ...GEOMETRY, spread: 0.5 });
    engine.paint();
    expect(offsetOf(elements[2] as CardElement)).toBeCloseTo(0.9375 * 320 * 0.5, 6);
    expect(elements[2]?.style.transform).toContain(`scale(${slotAt(1).size})`);
    expect(elements[2]?.style.transform).toContain(`rotateY(${slotAt(1).tilt}deg)`);
  });

  it('什么都没动时不排帧', () => {
    const { engine, hasFrame } = setup(3);
    engine.jumpTo(1);
    engine.paint();
    expect(hasFrame()).toBe(false);
  });
});

describe('遮罩：只有确定的落点才取消压暗', () => {
  const shadeOf = (element: FakeCard) => Number(element.vars['--shade']);
  const DIM = slotAt(1).shade;

  it('挂上时落点那一张直接亮着，别的照槽位的暗层', () => {
    const { engine, elements } = setup(5);
    engine.jumpTo(2);
    engine.paint();
    expect(shadeOf(elements[2] as FakeCard)).toBe(0);
    expect(shadeOf(elements[1] as FakeCard)).toBeCloseTo(DIM, 10);
    expect(shadeOf(elements[0] as FakeCard)).toBeCloseTo(slotAt(-2).shade, 10);
  });

  it('滚动途中封面经过正中也不取消压暗，只有落点那一张在到站后亮起来', () => {
    const { engine, elements, advance } = setup(7);
    engine.jumpTo(0);
    engine.paint();
    engine.goTo(6);
    // 走到第 3 张几乎正对中线时：它不是落点，位置在中间，暗层仍不低于紧邻一级
    let seen = 0;
    for (let t = 0; t < 700; t += 4) {
      advance(4);
      const gap = Math.abs(3 - engine.position());
      if (gap < 0.25) {
        seen++;
        expect(shadeOf(elements[3] as FakeCard)).toBeGreaterThanOrEqual(DIM - 1e-9);
      }
    }
    expect(seen).toBeGreaterThan(0);
    advance(MAX_GLIDE_MS);
    expect(engine.position()).toBe(6);
    expect(shadeOf(elements[6] as FakeCard)).toBeLessThan(0.01);
    expect(shadeOf(elements[0] as FakeCard)).toBeGreaterThanOrEqual(slotAt(-6).shade - 1e-9);
  });

  it('落点在飞行途中就开始点亮，到站时已经全亮', () => {
    const { engine, elements, advance } = setup(5);
    engine.jumpTo(0);
    engine.paint();
    engine.goTo(1);
    advance(120);
    const middle = shadeOf(elements[1] as FakeCard);
    advance(MAX_GLIDE_MS);
    expect(shadeOf(elements[1] as FakeCard)).toBe(0);
    expect(middle).toBeGreaterThan(0);
  });

  it('连续改目标时来不及点亮：每一张都保持压暗，停下后最后的落点才亮', () => {
    const { engine, elements, advance } = setup(12);
    engine.jumpTo(0);
    engine.paint();
    // 每 33 ms 前进一格，比点亮的时间常数短
    for (let target = 1; target <= 8; target++) {
      engine.goTo(target);
      advance(33);
      expect(shadeOf(elements[target] as FakeCard)).toBeGreaterThan(0.1);
    }
    advance(MAX_GLIDE_MS);
    expect(shadeOf(elements[8] as FakeCard)).toBeLessThan(0.01);
  });

  it('减弱动效：直接亮在落点上，不过渡', () => {
    const { engine, elements } = setup(5);
    engine.setReduced(true);
    engine.jumpTo(0);
    engine.paint();
    engine.goTo(3);
    engine.paint();
    expect(shadeOf(elements[3] as FakeCard)).toBe(0);
    expect(shadeOf(elements[0] as FakeCard)).toBeCloseTo(slotAt(-3).shade, 10);
  });
});

describe('goTo：浏览一步', () => {
  it('一步走完，途中逐帧写样式，走完通知一次并停帧', () => {
    let settled = 0;
    const { engine, elements, advance, hasFrame } = setup(5, { onSettle: () => settled++ });
    engine.jumpTo(2);
    engine.goTo(3);
    expect(hasFrame()).toBe(true);
    advance(100);
    const middle = engine.position();
    expect(middle).toBeGreaterThan(2);
    expect(middle).toBeLessThan(3);
    // 选中项还在往左让：位置在 0 与 −0.9375 个封面之间
    expect(offsetOf(elements[2] as CardElement)).toBeLessThan(0);
    advance(MAX_GLIDE_MS);
    expect(engine.position()).toBe(3);
    expect(settled).toBe(1);
    expect(hasFrame()).toBe(false);
    expect(elements[3]?.style.transform).toBe('translateX(0px) scale(1)');
  });

  it('中途改目标：从当时的位置接着走，位置不跳', () => {
    const { engine, advance } = setup(8);
    engine.jumpTo(2);
    engine.goTo(3);
    advance(96);
    const before = engine.position();
    engine.goTo(4);
    expect(engine.position()).toBeCloseTo(before, 10);
    advance(MAX_GLIDE_MS);
    expect(engine.position()).toBe(4);
  });

  it('中途改目标：速度也接着走，不从静止重起', () => {
    // 同样 100 ms 之后，带着速度接着走的比从静止重起的走得远
    const carried = setup(8);
    carried.engine.jumpTo(2);
    carried.engine.goTo(3);
    carried.advance(100);
    carried.engine.goTo(4);
    const startAt = carried.engine.position();
    carried.advance(100);
    const withSpeed = carried.engine.position() - startAt;

    const fresh = setup(8);
    fresh.engine.jumpTo(startAt);
    fresh.engine.goTo(4);
    fresh.advance(100);
    const fromRest = fresh.engine.position() - startAt;
    expect(withSpeed).toBeGreaterThan(fromRest);
  });

  it('回到很远的位置：用的时间和走一步差不多，不会因为远而慢很多', () => {
    const { engine, advance } = setup(12);
    engine.jumpTo(10);
    engine.goTo(1);
    advance(300);
    expect(engine.position()).toBeGreaterThan(1);
    advance(1200);
    expect(engine.position()).toBe(1);
  });

  it('减弱动效：直接跳到目标，不排帧', () => {
    let settled = 0;
    const { engine, hasFrame } = setup(5, { onSettle: () => settled++ });
    engine.setReduced(true);
    engine.jumpTo(0);
    engine.goTo(3);
    expect(engine.position()).toBe(3);
    expect(hasFrame()).toBe(false);
    expect(settled).toBe(1);
  });

  it('页面不可见：直接跳到目标；进行中的补间落到终点', () => {
    const { engine, advance } = setup(5);
    engine.jumpTo(0);
    engine.goTo(3);
    advance(50);
    engine.setVisible(false);
    expect(engine.position()).toBe(3);
    engine.goTo(1);
    expect(engine.position()).toBe(1);
  });

  it('目标没变不起补间', () => {
    let settled = 0;
    const { engine, hasFrame } = setup(5, { onSettle: () => settled++ });
    engine.jumpTo(2);
    engine.goTo(2);
    expect(hasFrame()).toBe(false);
    expect(settled).toBe(1);
  });
});

describe('rekey：条目表重排后卡留在原地', () => {
  it('前面多了一条，选中项的下标后移，位置跟着，卡不动', () => {
    const { engine, elements, cards } = setup(3);
    engine.jumpTo(1);
    engine.paint();
    const before = elements.map((element) => element.style.transform);
    // 新表在最前面多了一条，原来的 k0、k1、k2 下标各加一
    engine.setCards(cards.map((card) => ({ ...card, index: card.index + 1 })));
    engine.rekey(['k0', 'k1', 'k2'], ['x', 'k0', 'k1', 'k2'], 2);
    engine.paint();
    expect(elements.map((element) => element.style.transform)).toEqual(before);
  });

  it('选中项被移走：位置接在相邻的卡上，再补间到新目标', () => {
    const { engine, advance } = setup(4);
    engine.jumpTo(2);
    // k2 没了：以 k1 为锚，位置 2 比 k1 靠右 1，新表里 k1 在 1，所以落在 2 上，目标是 1
    engine.rekey(['k0', 'k1', 'k2', 'k3'], ['k0', 'k1', 'k3'], 1);
    expect(engine.position()).toBe(2);
    advance(MAX_GLIDE_MS);
    expect(engine.position()).toBe(1);
  });
});

describe('leave：退场期间位置定住', () => {
  it('补间还在走时退出：停在此刻的位置，之后改目标、重排都不再动', () => {
    const { engine, advance } = setup(8);
    engine.jumpTo(2);
    engine.goTo(6);
    advance(100);
    const stopped = engine.position();
    expect(stopped).toBeGreaterThan(2);
    expect(stopped).toBeLessThan(6);
    engine.leave();
    engine.goTo(3);
    engine.rekey(['k0', 'k1', 'k2'], ['x', 'k0', 'k1', 'k2'], 5);
    advance(500);
    expect(engine.position()).toBe(stopped);
  });

  it('淡出期间每张卡的位置不变，只有不透明度在变', () => {
    const { engine, elements, advance } = setup(5);
    engine.jumpTo(2);
    engine.paint();
    const before = elements.map((element) => offsetOf(element));
    engine.leave();
    advance(80);
    expect(elements.map((element) => offsetOf(element))).toEqual(before);
    expect(opacityOf(elements[1] as CardElement)).toBeLessThan(slotAt(-1).opacity);
  });

  it('退场放完后停帧，遮罩没到位也不再排帧', () => {
    const { engine, hasFrame, advance } = setup(5);
    engine.jumpTo(2);
    engine.paint();
    // 退出前刚改过目标，点亮系数还在路上
    engine.goTo(3);
    advance(40);
    engine.leave();
    advance(EXIT_MS + 100);
    expect(hasFrame()).toBe(false);
  });
});

describe('enter：进入时侧封面自屏外依次飞入', () => {
  function entered(count = 7, center = 3) {
    const env = setup(count);
    env.engine.jumpTo(center);
    env.engine.enter(center);
    env.engine.paint();
    return env;
  }

  it('起点：选中项在原位，其余在右缘之外、不倾斜', () => {
    const { elements } = entered();
    expect(elements[3]?.style.transform).toBe('translateX(0px) scale(1)');
    for (const [index, element] of elements.entries()) {
      if (index === 3) continue;
      expect(offsetOf(element)).toBeGreaterThan(640);
      expect(tilted(element)).toBe(false);
    }
  });

  it('从最左一张起飞，间隔 40 ms：同一时刻越靠左的越靠前', () => {
    const { elements, advance } = entered();
    advance(ENTRY_DELAY_MS + 80);
    const offsets = [0, 1, 2, 4, 5, 6].map((index) => offsetOf(elements[index] as CardElement));
    const progressed = offsets.map((offset, order) => ({ offset, order }));
    // 起飞晚的还在屏外起点（偏移最大），起飞早的已经离开
    expect(progressed[0]?.offset).toBeLessThan(progressed[1]?.offset ?? 0);
    expect(progressed[1]?.offset).toBeLessThan(progressed[2]?.offset ?? 0);
    expect(progressed[5]?.offset).toBeGreaterThan(640);
  });

  it('倾角另走一条时间线：起飞后先平着飞，TILT_DELAY_MS 后才转，落位时与槽位一致', () => {
    const { elements, advance, hasFrame } = entered();
    advance(ENTRY_DELAY_MS + 80);
    const flying = elements[0] as CardElement;
    // 起飞 80 ms，位置已走过大半（过了中线），倾角还是 0
    expect(offsetOf(flying)).toBeLessThan(0);
    expect(tilted(flying)).toBe(false);
    advance(120);
    expect(tilted(flying)).toBe(true);
    const expected = slotAt(-3);
    const middleTilt = Number(/rotateY\((-?[\d.e+-]+)deg\)/.exec(flying.style.transform)?.[1]);
    expect(middleTilt).toBeGreaterThan(0);
    expect(middleTilt).toBeLessThan(expected.tilt);
    advance(entryEnd(6));
    expect(hasFrame()).toBe(false);
    for (const [index, element] of elements.entries()) {
      expect(offsetOf(element)).toBeCloseTo(slotAt(index - 3).offset * 320, 6);
    }
  });

  it('侧封面不透明度从一开始就是槽位的值，不淡入', () => {
    const { elements } = entered();
    expect(opacityOf(elements[0] as CardElement)).toBeCloseTo(slotAt(-3).opacity, 6);
  });

  it('入场途中浏览：位置补间与入场互不干扰', () => {
    const { engine, advance } = entered(9, 4);
    advance(300);
    engine.goTo(5);
    advance(MAX_GLIDE_MS);
    expect(engine.position()).toBe(5);
  });

  it('页面不可见时进入直接到位', () => {
    const env = setup(5);
    env.engine.setVisible(false);
    env.engine.jumpTo(2);
    env.engine.enter(2);
    env.engine.paint();
    expect(env.hasFrame()).toBe(false);
    expect(offsetOf(env.elements[4] as CardElement)).toBeCloseTo(slotAt(2).offset * 320, 6);
  });
});

describe('enter：减弱动效时只淡入', () => {
  it('侧封面一直在槽位上，不透明度 0 线性涨到槽位的值；选中项不淡入', () => {
    const { engine, elements, advance } = setup(5);
    engine.setReduced(true);
    engine.jumpTo(2);
    engine.enter(2);
    engine.paint();
    expect(opacityOf(elements[2] as CardElement)).toBe(1);
    expect(opacityOf(elements[4] as CardElement)).toBe(0);
    expect(elements[4]?.style.visibility).toBe('hidden');
    expect(offsetOf(elements[4] as CardElement)).toBeCloseTo(slotAt(2).offset * 320, 6);
    advance(REDUCED_FADE_MS / 2);
    expect(opacityOf(elements[4] as CardElement)).toBeCloseTo(slotAt(2).opacity * 0.5, 1);
    advance(REDUCED_FADE_MS);
    expect(opacityOf(elements[4] as CardElement)).toBeCloseTo(slotAt(2).opacity, 6);
  });
});

describe('leave：退出时整排淡出', () => {
  it('正在播放那张当帧藏起，其余在 167 ms 内淡到 0 并停帧', () => {
    const { engine, elements, advance, hasFrame } = setup(5);
    engine.jumpTo(2);
    engine.paint();
    engine.leave();
    advance(16);
    expect(elements[2]?.style.visibility).toBe('hidden');
    expect(elements[3]?.style.visibility).toBe('visible');
    advance(EXIT_MS);
    expect(opacityOf(elements[3] as CardElement)).toBe(0);
    expect(elements[3]?.style.visibility).toBe('hidden');
    expect(hasFrame()).toBe(false);
  });

  it('页面不可见时退出直接藏起', () => {
    const { engine, elements } = setup(3);
    engine.jumpTo(1);
    engine.setVisible(false);
    engine.leave();
    engine.paint();
    expect(elements[0]?.style.visibility).toBe('hidden');
    expect(elements[2]?.style.visibility).toBe('hidden');
  });
});

describe('dispose', () => {
  it('取消待执行的帧', () => {
    const { engine, hasFrame } = setup(3);
    engine.jumpTo(0);
    engine.goTo(2);
    expect(hasFrame()).toBe(true);
    engine.dispose();
    expect(hasFrame()).toBe(false);
  });

  it('动效没放完时卸载又挂上（严格模式），下一次 paint 接着放', () => {
    const { engine, hasFrame, advance, elements } = setup(5);
    engine.jumpTo(2);
    engine.enter(2);
    engine.dispose();
    expect(hasFrame()).toBe(false);
    engine.paint();
    expect(hasFrame()).toBe(true);
    advance(entryEnd(4) + 16);
    expect(offsetOf(elements[4] as CardElement)).toBeCloseTo(slotAt(2).offset * 320, 6);
  });
});
