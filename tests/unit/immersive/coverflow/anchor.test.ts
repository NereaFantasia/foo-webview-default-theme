import { describe, expect, it } from 'vitest';
import { reanchor } from '../../../../src/immersive/coverflow/anchor.ts';

const keys = (...names: string[]) => names;

describe('reanchor：条目表重排后按键接上浏览位置', () => {
  it('表没变，位置不变', () => {
    const list = keys('a', 'b', 'c', 'd');
    expect(reanchor(list, 2, list, 0)).toBe(2);
    expect(reanchor(list, 1.4, list, 0)).toBeCloseTo(1.4, 10);
  });

  it('前面多了几条，位置整体后移，卡留在原地', () => {
    const before = keys('a', 'b', 'c');
    const after = keys('x', 'y', 'a', 'b', 'c');
    expect(reanchor(before, 1, after, 0)).toBe(3);
  });

  it('前面少了几条，位置整体前移', () => {
    const before = keys('x', 'y', 'a', 'b', 'c');
    const after = keys('a', 'b', 'c');
    expect(reanchor(before, 3, after, 0)).toBe(1);
  });

  it('补间途中的小数部分带过去', () => {
    const before = keys('a', 'b', 'c');
    const after = keys('x', 'a', 'b', 'c');
    expect(reanchor(before, 1.3, after, 0)).toBeCloseTo(2.3, 10);
  });

  it('锚被移走时用相邻的、还在的那条，保持相对距离', () => {
    const before = keys('a', 'b', 'c', 'd');
    // b 被摘掉（比如被起播，键随段名换了）：以离它最近的 a 为锚
    const after = keys('a', 'c', 'd');
    expect(reanchor(before, 1, after, 0)).toBe(1);
  });

  it('锚被移走时先试靠左的邻居，再试靠右的', () => {
    const before = keys('a', 'b', 'c');
    // 左右邻居都在时用左边的 a：位置 1 比 a 靠右 1，落在下标 1
    expect(reanchor(before, 1, keys('a', 'c'), 5)).toBe(1);
    // 只剩右边的 c：位置 1 比 c 靠左 1，夹回下标 0
    expect(reanchor(before, 1, keys('c', 'x'), 5)).toBe(0);
  });

  it('一张都对不上时回退到 fallback', () => {
    expect(reanchor(keys('a', 'b'), 1, keys('x', 'y'), 1)).toBe(1);
    expect(reanchor(keys('a'), 0, keys('x'), 0)).toBe(0);
  });

  it('旧表或新表是空的回退到 fallback', () => {
    expect(reanchor([], 0, keys('a'), 0)).toBe(0);
    expect(reanchor(keys('a'), 0, [], 3)).toBe(3);
  });

  it('结果夹在新表范围内', () => {
    const before = keys('a', 'b', 'c', 'd');
    const after = keys('a', 'b');
    // 位置落在被删掉的尾部：以 d 之前最近的 b 为锚，再夹回表内
    expect(reanchor(before, 3, after, 0)).toBe(1);
  });

  it('位置超出旧表范围时按最近的一张算', () => {
    const list = keys('a', 'b');
    expect(reanchor(list, 5, list, 0)).toBe(1);
    expect(reanchor(list, -2, list, 0)).toBe(0);
  });

  it('起播队列里的一条：它变成正在播放，其余的卡位置跟着键走', () => {
    // 选中 q2（下标 4），Enter 起播后：q2 的键换成 current，原当前曲变已播，q1 位置不变
    const before = keys('played:a', 'current:A', 'queued:q1', 'queued:q2', 'queued:q3');
    const after = keys('played:a', 'played:A', 'current:Q2', 'queued:q1', 'queued:q3');
    // 位置 3 在 q2：它不在新表里，找左邻 q1（新下标 3），距离 1，落在下标 4
    expect(reanchor(before, 3, after, 2)).toBe(4);
  });
});
