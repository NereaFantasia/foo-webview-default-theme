import { describe, expect, it } from 'vitest';
import { lexQuery } from '../../../../src/track/syntax/queryLexer.ts';

const shape = (text: string) =>
  lexQuery(text)
    .filter((token) => token.kind !== 'space')
    .map((token) => `${token.kind}:${token.text}`);

describe('lexQuery', () => {
  it('记号首尾相接盖住整段文字，半截输入也一样', () => {
    for (const text of [
      'artist IS "Radiohead" AND %rating% GREATER 3',
      '"$left(%date%,3)" IS 199',
      '(artist IS "abc',
      'a IS b SORT BY %artist% | $num(%tracknumber%,2)',
      '%rat',
      '$',
      '',
    ]) {
      const tokens = lexQuery(text);
      expect(tokens.map((token) => token.text).join('')).toBe(text);
      tokens.forEach((token, at) => {
        expect(token.start).toBe(tokens[at - 1]?.end ?? 0);
      });
    }
  });

  it('认出关键字、字段、引号串与数字，运算符前的裸词是字段', () => {
    expect(shape('artist IS "Radiohead" AND %rating% GREATER 3')).toEqual([
      'field:artist',
      'keyword:IS',
      'string:"',
      'string:Radiohead',
      'string:"',
      'keyword:AND',
      'field:%rating%',
      'keyword:GREATER',
      'number:3',
    ]);
  });

  it('HAS、IS 之后不加引号的词是值，不是字段也不是关键字', () => {
    expect(shape('genre IS and')).toEqual(['field:genre', 'keyword:IS', 'string:and']);
    const value = lexQuery('genre IS and').find((token) => token.text === 'and');
    expect(value?.lowercaseKeyword).toBeUndefined();
  });

  it('引号里的字段与函数被拆出来着色', () => {
    expect(shape('"$left(%date%,3)" IS 199')).toEqual([
      'string:"',
      'function:$left',
      'paren:(',
      'field:%date%',
      'string:,3',
      'paren:)',
      'string:"',
      'keyword:IS',
      'number:199',
    ]);
  });

  it('引号、百分号没写完时记为没写完', () => {
    expect(lexQuery('artist IS "abc').some((token) => token.open)).toBe(true);
    const field = lexQuery('%rating GREATER 3 AND %codec% IS flac')[0];
    expect(field?.kind).toBe('field');
    expect(field?.open).toBe(true);
    expect(field?.text).toBe('%rating');
  });

  it('SORT BY 之后是排序表达式，里面的 AND 不当关键字', () => {
    const tokens = lexQuery('a IS b SORT BY %artist% AND %title%');
    const tail = tokens.filter((token) => token.region === 'format' && token.kind !== 'space');
    expect(tail.map((token) => `${token.kind}:${token.text}`)).toEqual([
      'field:%artist%',
      'word:AND',
      'field:%title%',
    ]);
  });

  it('写成小写的关键字被标出来', () => {
    const word = lexQuery('artist is x').find((token) => token.text === 'is');
    expect(word?.kind).toBe('word');
    expect(word?.lowercaseKeyword).toBe(true);
  });

  it('时间单位只在 LAST 或数字之后才是关键字', () => {
    expect(shape('%added% DURING LAST 2 WEEKS')).toEqual([
      'field:%added%',
      'keyword:DURING',
      'keyword:LAST',
      'number:2',
      'keyword:WEEKS',
    ]);
    expect(
      lexQuery('title HAS WEEKS').some(
        (token) => token.text === 'WEEKS' && token.kind === 'keyword',
      ),
    ).toBe(false);
  });

  it('不认识的函数名被标出，括号与方括号只在引号和排序里出现', () => {
    const unknown = lexQuery('"$nosuch(x)" IS 1').find((token) => token.kind === 'function');
    expect(unknown?.unknown).toBe(true);
    expect(shape('[x]')).toEqual(['word:[x]']);
  });
});

describe('lexQuery 的起始区域', () => {
  it('排序框整段按 Title Formatting 切：没有 SORT BY 也不把词当关键字或查询里的字段', () => {
    const tokens = lexQuery('%artist% | $num(%tracknumber%,2) ALL', 'format').filter(
      (token) => token.kind !== 'space',
    );
    expect(tokens.every((token) => token.region === 'format')).toBe(true);
    expect(tokens.map((token) => `${token.kind}:${token.text}`)).toContain('field:%artist%');
    expect(tokens.some((token) => token.kind === 'keyword')).toBe(false);
  });
});
