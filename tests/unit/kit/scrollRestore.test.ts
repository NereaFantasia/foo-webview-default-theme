import { describe, expect, it } from 'vitest';
import { createScrollRestore, RESTORE_WINDOW_MS } from '../../../src/kit/scrollRestore.ts';

/** 一个滚动容器：写进去的值像浏览器那样夹到 0 与 `max` 之间。 */
function scroller(max: number) {
  let top = 0;
  const element = {
    max,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(element.max, Math.max(0, value));
    },
  };
  return element;
}

function setup() {
  let clock = 0;
  const restore = createScrollRestore(() => clock);
  return { restore, advance: (ms: number) => (clock += ms) };
}

describe('createScrollRestore', () => {
  it('目标够得着：设一次就撤，之后用户滚走不被拉回', () => {
    const { restore } = setup();
    const element = scroller(5000);
    const items = {};
    restore.hold(1200, items);
    restore.commit(element, items);
    expect(element.scrollTop).toBe(1200);
    element.scrollTop = 0;
    restore.commit(element, {});
    expect(element.scrollTop).toBe(0);
  });

  it('目标超出内容：停在最低处；同一份条目流之后的提交不再去设', () => {
    const { restore } = setup();
    const element = scroller(800);
    const items = {};
    restore.hold(3000, items);
    restore.commit(element, items);
    expect(element.scrollTop).toBe(800);
    element.max = 3000;
    restore.commit(element, items);
    expect(element.scrollTop).toBe(800);
  });

  it('目标超出内容，条目流随后变了一次：再设一次就撤', () => {
    const { restore } = setup();
    const element = scroller(800);
    const items = {};
    restore.hold(3000, items);
    restore.commit(element, items);
    expect(element.scrollTop).toBe(800);
    element.max = 5000;
    restore.commit(element, {});
    expect(element.scrollTop).toBe(3000);
    element.scrollTop = 100;
    restore.commit(element, {});
    expect(element.scrollTop).toBe(100);
  });

  it('目标超出内容，用户自己滚过：作罢，条目流再变也不设', () => {
    const { restore } = setup();
    const element = scroller(800);
    const items = {};
    restore.hold(3000, items);
    restore.commit(element, items);
    element.scrollTop = 0;
    restore.commit(element, items);
    element.max = 5000;
    restore.commit(element, {});
    expect(element.scrollTop).toBe(0);
  });

  it('目标超出内容，用户没滚而是动了别的（cancel）：条目流再变也不设', () => {
    const { restore } = setup();
    const element = scroller(800);
    const items = {};
    restore.hold(3000, items);
    restore.commit(element, items);
    expect(element.scrollTop).toBe(800);
    restore.cancel();
    element.max = 5000;
    restore.commit(element, {});
    expect(element.scrollTop).toBe(800);
  });

  it('挂着过了期限：条目流再变也不设', () => {
    const { restore, advance } = setup();
    const element = scroller(800);
    const items = {};
    restore.hold(3000, items);
    restore.commit(element, items);
    expect(element.scrollTop).toBe(800);
    advance(RESTORE_WINDOW_MS + 1);
    element.max = 5000;
    restore.commit(element, {});
    expect(element.scrollTop).toBe(800);
  });

  it('期限之内条目流变了照设', () => {
    const { restore, advance } = setup();
    const element = scroller(800);
    const items = {};
    restore.hold(3000, items);
    restore.commit(element, items);
    expect(element.scrollTop).toBe(800);
    advance(RESTORE_WINDOW_MS - 1);
    element.max = 5000;
    restore.commit(element, {});
    expect(element.scrollTop).toBe(3000);
  });
});
