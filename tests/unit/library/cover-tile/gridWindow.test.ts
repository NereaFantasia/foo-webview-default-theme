import { describe, expect, it } from 'vitest';
import { visibleRows } from '../../../../src/library/cover-tile/gridWindow.ts';

describe('平铺网格要画的行', () => {
  it('视口里的行上下各多画几行，夹在总行数之内', () => {
    // 行高 200，视口 600，网格上沿正好在视口上沿
    expect(visibleRows(0, 600, 200, 100, 2)).toEqual({ first: 0, last: 5 });
    // 滚过去 1000：第 5 行压着视口上沿，视口里是第 5 至 7 行
    expect(visibleRows(-1000, 600, 200, 100, 2)).toEqual({ first: 3, last: 10 });
    // 滚过去半行：压着视口上沿的那一行也算
    expect(visibleRows(-100, 600, 200, 100, 0)).toEqual({ first: 0, last: 4 });
  });

  it('网格还在视口下面、已滚过、没有行或行高不对', () => {
    expect(visibleRows(900, 600, 200, 100, 2)).toEqual({ first: 0, last: 1 });
    expect(visibleRows(-50000, 600, 200, 10, 2)).toEqual({ first: 10, last: 10 });
    expect(visibleRows(0, 600, 200, 0, 2)).toEqual({ first: 0, last: 0 });
    expect(visibleRows(0, 600, 0, 7, 2)).toEqual({ first: 0, last: 7 });
  });
});
