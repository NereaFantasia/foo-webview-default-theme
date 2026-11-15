import { describe, expect, it } from 'vitest';
import { lexQuery } from '../../../../src/track/syntax/queryLexer.ts';
import { splitSortClause } from '../../../../src/track/syntax/querySort.ts';

describe('splitSortClause', () => {
  it('没有排序子句：条件就是整段', () => {
    expect(splitSortClause('genre IS Jazz')).toEqual({ condition: 'genre IS Jazz', clause: null });
  });

  it('SORT BY 是升序，条件部分不带它', () => {
    expect(splitSortClause('ALL SORT BY %title%')).toEqual({
      condition: 'ALL ',
      clause: { direction: 'ascending', expression: '%title%' },
    });
  });

  it('SORT DESCENDING BY 是降序；SORT ASCENDING BY 是升序；表达式去首尾空白', () => {
    expect(splitSortClause('genre IS Jazz SORT DESCENDING BY %artist% | %album%  ')).toEqual({
      condition: 'genre IS Jazz ',
      clause: { direction: 'descending', expression: '%artist% | %album%' },
    });
    expect(splitSortClause('ALL SORT ASCENDING BY %date%').clause?.direction).toBe('ascending');
  });

  it('写到一半的排序子句当条件，不拆：缺 BY、缺表达式之外的部分交给宿主判', () => {
    expect(splitSortClause('ALL SORT')).toEqual({ condition: 'ALL SORT', clause: null });
    expect(splitSortClause('ALL SORT DESCENDING')).toEqual({
      condition: 'ALL SORT DESCENDING',
      clause: null,
    });
  });

  it('引号里的 SORT 不算排序子句', () => {
    const text = 'title IS "SORT BY me"';
    expect(splitSortClause(text)).toEqual({ condition: text, clause: null });
  });
});

describe('lexQuery 认 SORT DESCENDING BY', () => {
  it('BY 之后是排序表达式：字段与函数按 Title Formatting 切，DESCENDING 是关键字', () => {
    const tokens = lexQuery('ALL SORT DESCENDING BY %artist%').filter(
      (token) => token.kind !== 'space',
    );
    expect(tokens.map((token) => `${token.kind}:${token.text}`)).toEqual([
      'keyword:ALL',
      'keyword:SORT',
      'keyword:DESCENDING',
      'keyword:BY',
      'field:%artist%',
    ]);
    expect(tokens[4]?.region).toBe('format');
  });
});
