import { lexQuery } from './queryLexer.ts';

// 查询末尾排序子句解析（`SORT BY` / `SORT ASCENDING BY` / `SORT DESCENDING BY`）；自动播放列表降序需写在查询中；
// 宿主 `library.query` 不接收排序子句，计算命中数前需先剥离排序子句

export interface SortClause {
  readonly direction: 'ascending' | 'descending';
  /** `BY` 后面的排序表达式，已去首尾空白 */
  readonly expression: string;
}

export interface SplitQuery {
  /** 排序子句之前的条件部分，原样；没有排序子句时就是整段文字 */
  readonly condition: string;
  /** 完整的排序子句；没有，或写到一半（缺 `BY`）时为 null，写到一半的当条件，交给宿主去判 */
  readonly clause: SortClause | null;
}

/** 把查询文字拆成条件与排序子句；引号里的 `SORT` 不算 */
export function splitSortClause(text: string): SplitQuery {
  const tokens = lexQuery(text).filter((token) => token.kind !== 'space');
  const sort = tokens.findIndex(
    (token) => token.kind === 'keyword' && token.text === 'SORT' && token.region === 'query',
  );
  const whole: SplitQuery = { condition: text, clause: null };
  if (sort < 0) return whole;
  const direction = tokens[sort + 1];
  const descending = direction?.text === 'DESCENDING';
  const given = descending || direction?.text === 'ASCENDING';
  const by = tokens[sort + (given ? 2 : 1)];
  if (by?.kind !== 'keyword' || by.text !== 'BY') return whole;
  return {
    condition: text.slice(0, tokens[sort]!.start),
    clause: {
      direction: descending ? 'descending' : 'ascending',
      expression: text.slice(by.end).trim(),
    },
  };
}
