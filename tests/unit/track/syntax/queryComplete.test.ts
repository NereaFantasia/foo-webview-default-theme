import { describe, expect, it } from 'vitest';
import {
  applyCompletion,
  completeAt,
  insertEntry,
} from '../../../../src/track/syntax/queryComplete.ts';
import { FIELDS, FUNCTIONS, OPERATORS } from '../../../../src/track/syntax/syntaxTable.ts';

const names = (text: string, caret = text.length, manual = false) =>
  completeAt(text, caret, manual)?.items.map((item) => item.entry.name);
const entry = (list: readonly { id: string }[], id: string) => {
  const found = list.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found as (typeof FIELDS)[number];
};

describe('completeAt', () => {
  it('键入 % 后按前缀补字段，替换的是整个记号', () => {
    const done = completeAt('artist IS "x" AND %r', 20);
    expect(done?.from).toBe(18);
    expect(done?.to).toBe(20);
    const found = done?.items.map((item) => item.entry.name) ?? [];
    expect(found).toContain('%rating%');
    expect(found).toContain('%replaygain_track_gain%');
    expect(found.every((name) => name.startsWith('%r'))).toBe(true);
  });

  it('引号里补函数原样落；查询本体里补函数替用户包上引号', () => {
    expect(names('artist IS "x" AND "$le')).toEqual(['$left', '$len']);
    const bare = completeAt('artist IS x AND $le', 19);
    expect(bare?.items[0]?.insert).toBe('"$left(X,Y)"');
    expect(bare?.items[0]?.select).toEqual([7, 8]);
  });

  it('字段之后补运算符，不补连接词', () => {
    const found = names('genre ') ?? [];
    expect(found).toContain('HAS');
    expect(found).toContain('GREATER');
    expect(found).not.toContain('AND');
  });

  it('一个完整条件之后补连接词与排序，而不是运算符', () => {
    expect(names('artist IS x ')).toEqual(['AND', 'OR', 'SORT BY', 'SORT DESCENDING BY']);
    expect(names('artist IS x AN')).toEqual(['AND']);
  });

  it('开头只在有前缀时补字段；带空格的字段名补成带引号的', () => {
    expect(completeAt('', 0)).toBeNull();
    expect(names('ar')).toEqual(['%artist%']);
    const album = completeAt('al', 2);
    expect(album?.items.map((item) => item.insert)).toContain('"album artist"');
    expect(completeAt('', 0, true)?.items.length).toBeGreaterThan(10);
  });

  it('词已经写全、没有更多可补时不再弹', () => {
    expect(completeAt('artist IS x AND', 15)).toBeNull();
    expect(completeAt('artist IS ', 10)).toBeNull();
  });

  it('补运算符之后落成带占位的模板，光标落在占位上', () => {
    const text = 'genre ';
    const done = completeAt(text, text.length);
    const has = done?.items.find((item) => item.entry.id === 'has');
    expect(done && has && applyCompletion(text, done, has)).toEqual({
      text: 'genre HAS ""',
      start: 11,
      end: 11,
    });
    const greater = completeAt('x ', 2)?.items.find((item) => item.entry.id === 'greater');
    expect(greater && applyCompletion('x ', completeAt('x ', 2)!, greater)).toEqual({
      text: 'x GREATER 0',
      start: 10,
      end: 11,
    });
  });

  it('前面紧挨着字时补一个空格，括号后面不补', () => {
    const text = 'artist IS x AN';
    const done = completeAt(text, text.length);
    const filled = done && applyCompletion(text, done, done.items[0]!);
    expect(filled?.text).toBe('artist IS x AND ');
    const open = completeAt('(ar', 3);
    expect(open && applyCompletion('(ar', open, open.items[0]!).text).toBe('(artist');
  });
});

describe('insertEntry', () => {
  it('空框里点字段写成裸名字，点函数包上引号并选中第一个参数', () => {
    expect(insertEntry('', 0, 0, entry(FIELDS, 'artist'))).toEqual({
      text: 'artist',
      start: 6,
      end: 6,
    });
    expect(insertEntry('', 0, 0, entry(FUNCTIONS, 'left'))).toEqual({
      text: '"$left(X,Y)"',
      start: 7,
      end: 8,
    });
  });

  it('已有完整条件时再点字段，先接 AND', () => {
    const text = 'artist IS x';
    expect(insertEntry(text, text.length, text.length, entry(FIELDS, 'album')).text).toBe(
      'artist IS x AND album',
    );
  });

  it('点运算符接在字段后面，缺的空格补上，占位被选中', () => {
    const text = 'genre';
    expect(insertEntry(text, 5, 5, entry(OPERATORS, 'greater'))).toEqual({
      text: 'genre GREATER 0',
      start: 14,
      end: 15,
    });
  });

  it('光标在引号里时按格式表达式原样写，字段带百分号', () => {
    const text = '"$left(,3)" IS 199';
    const done = insertEntry(text, 7, 7, entry(FIELDS, 'date'));
    expect(done.text).toBe('"$left(%date%,3)" IS 199');
  });
});

describe('completeAt 的排序框（整段是 Title Formatting）', () => {
  it('键入 % 与 $ 照常补字段与函数，函数不替用户包引号', () => {
    const field = completeAt('%ar', 3, false, 'format');
    expect(field?.items.map((item) => item.entry.name)).toContain('%artist%');
    const fn = completeAt('$le', 3, false, 'format');
    expect(fn?.items[0]?.insert).toBe('$left(X,Y)');
  });

  it('裸词不补：这里的词不是字段，也不补 AND、SORT BY 这类查询关键字', () => {
    expect(completeAt('ar', 2, false, 'format')).toBeNull();
    expect(completeAt('%artist% ', 9, false, 'format')).toBeNull();
  });

  it('主动要且光标不在任何记号上时给 %字段%', () => {
    const done = completeAt('', 0, true, 'format');
    expect(done?.items[0]?.insert.startsWith('%')).toBe(true);
  });

  it('参考栏点字段与函数原样写进排序框，空框里也不写成查询里的裸字段', () => {
    expect(insertEntry('', 0, 0, entry(FIELDS, 'artist'), 'format').text).toBe('%artist%');
    expect(insertEntry('%artist% | ', 11, 11, entry(FIELDS, 'album'), 'format').text).toBe(
      '%artist% | %album%',
    );
  });
});

describe('completeAt 的写全判断', () => {
  it('字段已经写全、候选只剩它自己时不再出补全；还有别的候选或没写全时照出', () => {
    expect(completeAt('%title%', 7)).toBeNull();
    expect(completeAt('%title%', 7, false, 'format')).toBeNull();
    const partial = completeAt('%titl', 5);
    expect(partial?.items.map((item) => item.entry.name)).toContain('%title%');
    expect(completeAt('%track', 6)?.items.length).toBeGreaterThan(1);
  });
});
