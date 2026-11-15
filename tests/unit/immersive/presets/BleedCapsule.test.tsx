// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BleedCapsule } from '../../../../src/immersive/presets/bleed/BleedCapsule.tsx';
import { cubicBezier, CURVE } from '../../../../src/motion/timing.ts';
import {
  COLLAPSE_CURVE,
  reverseBezier,
} from '../../../../src/immersive/presets/bleed/capsuleMotion.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

let host: HTMLDivElement;
let outside: HTMLDivElement;

/** 提示、浮层这类挂在 body 下的内容：DOM 上不在胶囊里，React 树里在 */
function Floating() {
  return createPortal(<div data-floating>提示</div>, outside);
}

function mount(): HTMLElement {
  const root = createRoot(host);
  act(() =>
    root.render(
      <Provider store={createStore()}>
        <BleedCapsule head={<span>头</span>} body={<Floating />} />
      </Provider>,
    ),
  );
  return host.querySelector<HTMLElement>('[data-capsule]')!;
}

/** 指针从 `from` 移到 `to`：浏览器先发 mouseout（目标是旧的），再发 mouseover（目标是新的） */
function move(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }));
  });
}

describe('BleedCapsule：指针', () => {
  beforeEach(() => {
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    outside = document.createElement('div');
    document.body.append(host, outside);
  });
  afterEach(() => {
    host.remove();
    outside.remove();
  });

  it('指针进了胶囊就展开，离开就收起', () => {
    const capsule = mount();
    expect(capsule.hasAttribute('data-hover')).toBe(false);
    move(document.body, capsule);
    expect(capsule.hasAttribute('data-hover')).toBe(true);
    move(capsule, document.body);
    expect(capsule.hasAttribute('data-hover')).toBe(false);
  });

  it('指针从胶囊移到它里面的键的提示（挂在 body 下）上：仍算在胶囊里，不收起', () => {
    const capsule = mount();
    move(document.body, capsule);
    const floating = outside.querySelector('[data-floating]')!;
    move(capsule, floating);
    expect(capsule.hasAttribute('data-hover')).toBe(true);
    move(floating, document.body);
    expect(capsule.hasAttribute('data-hover')).toBe(false);
  });
});

describe('收起曲线：展开的倒放', () => {
  it('把曲线的两个控制点对调再翻转：先慢后快的 (1, 0, 1, 1) 与先快后慢的 (0, 0, 0, 1) 互为倒放', () => {
    expect(reverseBezier('cubic-bezier(0,0,0,1)')).toBe('cubic-bezier(1,0,1,1)');
    expect(reverseBezier('cubic-bezier(0.1, 0.9, 0.2, 1)')).toBe('cubic-bezier(0.8,0,0.9,0.1)');
    expect(reverseBezier('ease')).toBe('ease');
  });

  it('收起曲线取自展开曲线：时间反着走，进度恰好是展开的倒放 y′(x) = 1 − y(1 − x)', () => {
    const numbers = /cubic-bezier\(([^,]+),([^,]+),([^,]+),([^,)]+)\)/.exec(COLLAPSE_CURVE)!;
    const [x1, y1, x2, y2] = numbers.slice(1).map(Number) as [number, number, number, number];
    const collapse = cubicBezier(x1, y1, x2, y2);
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(collapse(x)).toBeCloseTo(1 - CURVE.decelerateMid.ease(1 - x), 3);
    }
  });
});
