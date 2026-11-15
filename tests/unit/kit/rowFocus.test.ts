// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveRowFocus } from '../../../src/kit/rowFocus.ts';

const ROW = '[data-row]';

describe('列表里方向键挪焦点', () => {
  let list: HTMLDivElement;

  beforeEach(() => {
    list = document.createElement('div');
    list.innerHTML = [
      '<button data-row="a">a</button>',
      '<button data-row="b" disabled>b</button>',
      '<button data-row="c">c</button>',
      '<button data-row="d">d</button>',
      '<button data-other>x</button>',
    ].join('');
    document.body.append(list);
  });
  afterEach(() => list.remove());

  const row = (name: string) => list.querySelector<HTMLElement>(`[data-row="${name}"]`)!;
  function press(key: string) {
    const preventDefault = vi.fn();
    moveRowFocus({ key, currentTarget: list, preventDefault }, ROW);
    return preventDefault;
  }

  it('上下键挪到相邻的行并拦下事件，禁用的行被跳过', () => {
    row('a').focus();
    expect(press('ArrowDown')).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(row('c'));
    press('ArrowDown');
    expect(document.activeElement).toBe(row('d'));
    press('ArrowUp');
    expect(document.activeElement).toBe(row('c'));
    press('ArrowUp');
    expect(document.activeElement).toBe(row('a'));
  });

  it('Home、End 直达首尾行', () => {
    row('c').focus();
    press('End');
    expect(document.activeElement).toBe(row('d'));
    press('Home');
    expect(document.activeElement).toBe(row('a'));
  });

  it('到头停住，不绕回', () => {
    row('d').focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(row('d'));
    row('a').focus();
    press('ArrowUp');
    expect(document.activeElement).toBe(row('a'));
  });

  it('焦点不在这些行上、或按的是别的键时不动也不拦事件', () => {
    const other = list.querySelector<HTMLElement>('[data-other]')!;
    other.focus();
    expect(press('ArrowDown')).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(other);
    row('a').focus();
    expect(press('Enter')).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row('a'));
  });
});
