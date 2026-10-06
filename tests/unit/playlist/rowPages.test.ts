import { describe, expect, it } from 'vitest';
import { playlistRowOf, type PlaylistRow } from '../../../src/playlist/playlistRow.ts';
import { MAX_PAGES, PAGE_SIZE, RowPages } from '../../../src/playlist/rowPages.ts';
import { makeRow } from '../../fixtures/fakePlaylists.ts';

/** 第 `page` 页的行，标题是「L 行号 + 1」。 */
function rowsOf(page: number, count = PAGE_SIZE): PlaylistRow[] {
  return Array.from({ length: count }, (_, at) =>
    playlistRowOf(makeRow('L', page * PAGE_SIZE + at)),
  );
}

describe('RowPages', () => {
  it('先取视口里的页，再往两侧交替预取、先往下；超出行数的不算', () => {
    const pages = new RowPages();
    expect(pages.wanted(1000)).toEqual([0, 1, 2]);
    pages.view([{ start: 450, end: 480 }], 2000);
    expect(pages.wanted(2000)).toEqual([2, 3, 1, 4, 0]);
    pages.view([{ start: 1950, end: 2000 }], 2000);
    expect(pages.wanted(2000)).toEqual([9, 8, 7]);
  });

  it('视口跨两页时两页都算视口；空列表也要取第 0 页，才知道行数与列表在不在', () => {
    const pages = new RowPages();
    pages.view([{ start: 190, end: 230 }], 5000);
    expect(pages.wanted(5000)).toEqual([0, 1, 2, 3]);
    expect(new RowPages().wanted(0)).toEqual([0]);
  });

  it('视口是隔得很远的几段（折起的组只露组头）：只取这几段所在的页，预取只在最前与最后两头', () => {
    const pages = new RowPages();
    const heads = [0, 5000, 5010, 12000].map((row) => ({ start: row, end: row + 1 }));
    pages.view(heads, 20000);
    expect(pages.wanted(20000)).toEqual([0, 25, 60, 61, 62]);
    pages.view([], 20000);
    expect(pages.wanted(20000)).toEqual([0, 25, 60, 61, 62]);
  });

  it('视口在行数之外（列表变短了、行数还不知道）时按最后一页算，行数变了跟着重算', () => {
    const pages = new RowPages();
    pages.view([{ start: 3000, end: 3030 }], 5000);
    expect(pages.wanted(0)).toEqual([0]);
    expect(pages.wanted(450)).toEqual([2, 1, 0]);
    expect(pages.wanted(5000)).toEqual([15, 16, 14, 17, 13]);
  });

  it('收下的页不再要；按行号取行与它取数时的戳，没取到的是 undefined', () => {
    const pages = new RowPages();
    pages.put(0, rowsOf(0), 450, 7);
    pages.put(2, rowsOf(2, 50), 450, 9);
    expect(pages.wanted(450)).toEqual([1]);
    expect(pages.rowAt(0)?.title).toBe('L 1');
    expect(pages.rowAt(449)?.title).toBe('L 450');
    expect(pages.stampAt(449)).toBe(9);
    expect(pages.rowAt(250)).toBeUndefined();
    expect(pages.stampAt(250)).toBeUndefined();
  });

  it('作废：视口附近的页标成过期，行与戳照旧能取，别处的丢掉', () => {
    const pages = new RowPages();
    for (const page of [0, 1, 2, 3, 9]) pages.put(page, rowsOf(page), 2000, page);
    pages.expire(2000, false);
    expect(pages.wanted(2000)).toEqual([0, 1, 2]);
    expect(pages.rowAt(PAGE_SIZE)?.title).toBe(`L ${PAGE_SIZE + 1}`);
    expect(pages.stampAt(PAGE_SIZE)).toBe(1);
    expect(pages.rowAt(PAGE_SIZE * 3)).toBeUndefined();
    expect(pages.rowAt(PAGE_SIZE * 9)).toBeUndefined();
  });

  it('行增删重排引起的作废：旧页照旧能取，但不再算行号对得上，取回新页后才算', () => {
    const pages = new RowPages();
    pages.put(0, rowsOf(0), 2000, 0);
    expect(pages.currentAt(3)).toBe(true);
    pages.expire(2000, false);
    expect(pages.currentAt(3)).toBe(true);
    pages.expire(2000, true);
    // 只改标签的作废跟在后面，也不抹掉「挪过」。
    pages.expire(2000, false);
    expect(pages.rowAt(3)?.title).toBe('L 4');
    expect(pages.currentAt(3)).toBe(false);
    expect(pages.currentAt(PAGE_SIZE + 3)).toBe(false);
    pages.put(0, rowsOf(0), 2000, 1);
    expect(pages.currentAt(3)).toBe(true);
  });

  it('行数变少时丢掉超出的页', () => {
    const pages = new RowPages();
    for (const page of [0, 1, 2]) pages.put(page, rowsOf(page), 600, 0);
    pages.put(0, rowsOf(0), 150, 1);
    expect(pages.rowAt(PAGE_SIZE)).toBeUndefined();
    expect(pages.rowAt(PAGE_SIZE * 2)).toBeUndefined();
    expect(pages.wanted(150)).toEqual([]);
  });

  it(`至多缓存 ${MAX_PAGES} 页：先丢最久没用到的，视口附近的留着`, () => {
    const pages = new RowPages();
    const total = PAGE_SIZE * 100;
    const cached = () =>
      Array.from({ length: 100 }, (_, page) => page).filter(
        (page) => pages.rowAt(page * PAGE_SIZE) !== undefined,
      );
    for (let page = 0; page <= MAX_PAGES; page += 1) pages.put(page, rowsOf(page), total, 0);
    // 视口一直在开头：0–2 页最早收下也留着，丢的是其后最旧的第 3 页。
    expect(cached()).toHaveLength(MAX_PAGES);
    expect(cached().slice(0, 4)).toEqual([0, 1, 2, 4]);

    // 视口挪到后面：开头那几页不再受保护，最旧的第 0 页先走。
    pages.view([{ start: 29 * PAGE_SIZE, end: 29 * PAGE_SIZE + 10 }], total);
    pages.put(40, rowsOf(40), total, 0);
    expect(cached()).toHaveLength(MAX_PAGES);
    expect(cached().slice(0, 3)).toEqual([1, 2, 4]);
    expect(cached()).toContain(40);
  });

  it('按 handle 认缓存里有没有这几首', () => {
    const pages = new RowPages();
    pages.put(0, rowsOf(0), 200, 0);
    const inside = rowsOf(0)[5]?.handle ?? '';
    expect(pages.holds(new Set([inside]))).toBe(true);
    expect(pages.holds(new Set(['E:/Music/Other/001.flac']))).toBe(false);
    pages.clear();
    expect(pages.holds(new Set([inside]))).toBe(false);
  });
});
