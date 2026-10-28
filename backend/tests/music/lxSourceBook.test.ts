import { describe, expect, it } from 'vitest';
import { startLxSourceBook } from '../../music/lxSourceBook.ts';

describe('音源失败簿', () => {
  it('连续失败两次才跳过，十分钟后放回，成功一次清零', () => {
    let at = 1_000;
    const book = startLxSourceBook(() => at);
    book.failed('kw', '长青');
    expect(book.skipped('kw')).toEqual([]);
    book.failed('kw', '长青');
    expect(book.skipped('kw')).toEqual(['长青']);
    at += 10 * 60_000 - 1;
    expect(book.skipped('kw')).toEqual(['长青']);
    at += 1;
    expect(book.skipped('kw')).toEqual([]);
    // 放回后再失败一次就重新跳过
    book.failed('kw', '长青');
    expect(book.skipped('kw')).toEqual(['长青']);
    book.succeeded('kw', '长青');
    book.failed('kw', '长青');
    expect(book.skipped('kw')).toEqual([]);
  });

  it('按平台分开，名字不分大小写与首尾空白，清空后都放回', () => {
    const book = startLxSourceBook();
    book.failed('kw', 'Source A');
    book.failed('kw', ' source a ');
    book.failed('kg', '长青');
    book.failed('kg', '长青');
    expect(book.skipped('kw')).toEqual(['Source A']);
    expect(book.skipped('mg')).toEqual([]);
    expect(book.skipped('kg')).toEqual(['长青']);
    book.clear();
    expect(book.skipped('kw')).toEqual([]);
    expect(book.skipped('kg')).toEqual([]);
  });
});
