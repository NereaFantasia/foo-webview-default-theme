import {
  COMPARISONS,
  KEYWORDS,
  TIME_COMPARISONS,
  TIME_UNITS,
  isKnownFunction,
} from './syntaxTable.ts';

// 查询文本词法分词，供高亮、诊断与补全使用；容忍未完成输入，记号首尾连续覆盖完整文本
// 三个区域：查询本体；双引号里（字段位置可以写 Title Formatting，里面的字段与函数要着色）；`SORT BY` 之后整段排序表达式

export type TokenKind =
  | 'keyword'
  | 'field'
  | 'function'
  | 'string'
  | 'literal'
  | 'number'
  | 'paren'
  | 'bracket'
  | 'word'
  | 'space';

export type Region = 'query' | 'quoted' | 'format';

export interface Token {
  readonly kind: TokenKind;
  readonly start: number;
  /** 不含 */
  readonly end: number;
  readonly text: string;
  readonly region: Region;
  /** 没写完：缺右引号、缺右 %、缺右单引号 */
  readonly open?: boolean;
  /** 关键字写成了小写或混写 */
  readonly lowercaseKeyword?: boolean;
  /** 函数名不在语法表里 */
  readonly unknown?: boolean;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const SPACE = /\s/;
const QUERY_STOP = /[\s()"%$]/;
const FORMAT_STOP = /[\s()[\]'%$]/;
const QUOTED_STOP = /[\s()[\]'"%$]/;
const FIELD_NAME = /^[^\s%"()][^%"()\n]*[^\s%"()]$|^[^\s%"()]$/;

/** 从 `at` 处的 `%` 起找字段：名字合规且有右 `%` 才算写全；否则只取到下一个空白或括号 */
function scanField(text: string, at: number): { end: number; open: boolean } {
  const close = text.indexOf('%', at + 1);
  if (close > at + 1 && FIELD_NAME.test(text.slice(at + 1, close))) {
    return { end: close + 1, open: false };
  }
  let end = at + 1;
  while (end < text.length && !/[\s")(%]/.test(text[end]!)) end++;
  return { end, open: true };
}

function scanFunction(text: string, at: number): number {
  let end = at + 1;
  while (end < text.length && /[A-Za-z_0-9]/.test(text[end]!)) end++;
  return end;
}

/** 单引号字面量：同一区域内有右引号才算 */
function scanLiteral(text: string, at: number, limit: RegExp): number {
  for (let end = at + 1; end < text.length; end++) {
    const ch = text[end]!;
    if (ch === "'") return end + 1;
    if (limit.test(ch) && ch !== ' ') break;
  }
  return -1;
}

function significant(
  tokens: readonly Mutable<Token>[],
  before: number,
): Mutable<Token> | undefined {
  for (let at = before - 1; at >= 0; at--) {
    const token = tokens[at]!;
    if (token.kind !== 'space' && token.region === 'query') return token;
  }
  return undefined;
}

/** `BY` 前面是 `SORT`，或是 `SORT` 后面的 `ASCENDING`、`DESCENDING`：从这里起是排序表达式 */
function startsSortClause(
  tokens: readonly Mutable<Token>[],
  before: Mutable<Token> | undefined,
): boolean {
  if (before?.text === 'SORT') return true;
  if (before?.text !== 'ASCENDING' && before?.text !== 'DESCENDING') return false;
  return significant(tokens, tokens.indexOf(before))?.text === 'SORT';
}

/** `start` 给 `format` 时整段按 Title Formatting 切：独立的排序框里没有 `SORT BY` 把区域切过去 */
export function lexQuery(text: string, start: Region = 'query'): readonly Token[] {
  const tokens: Mutable<Token>[] = [];
  let region: Region = start;
  let quote = -1;
  let at = 0;
  const push = (kind: TokenKind, start: number, end: number, extra: Partial<Token> = {}) => {
    tokens.push({ kind, start, end, text: text.slice(start, end), region, ...extra });
  };

  while (at < text.length) {
    const ch = text[at]!;
    if (SPACE.test(ch)) {
      let end = at + 1;
      while (end < text.length && SPACE.test(text[end]!)) end++;
      push('space', at, end);
      at = end;
      continue;
    }
    if (ch === '"' && region !== 'format') {
      if (region === 'query') {
        region = 'quoted';
        quote = tokens.length;
      } else {
        region = 'query';
        quote = -1;
      }
      push('string', at, at + 1);
      at++;
      continue;
    }
    if (ch === '%') {
      const { end, open } = scanField(text, at);
      push('field', at, end, open ? { open } : {});
      at = end;
      continue;
    }
    if (ch === '$') {
      const end = scanFunction(text, at);
      const name = text.slice(at + 1, end);
      push('function', at, end, name !== '' && !isKnownFunction(name) ? { unknown: true } : {});
      at = end;
      continue;
    }
    if (ch === '(' || ch === ')') {
      push('paren', at, at + 1);
      at++;
      continue;
    }
    if (region !== 'query' && (ch === '[' || ch === ']')) {
      push('bracket', at, at + 1);
      at++;
      continue;
    }
    if (region !== 'query' && ch === "'") {
      const end = scanLiteral(text, at, region === 'quoted' ? /["]/ : /$^/);
      if (end > 0) {
        push('literal', at, end);
        at = end;
        continue;
      }
    }
    const stop = region === 'query' ? QUERY_STOP : region === 'quoted' ? QUOTED_STOP : FORMAT_STOP;
    let end = at + 1;
    while (end < text.length && !stop.test(text[end]!)) end++;
    const word = text.slice(at, end);
    if (region === 'quoted') {
      push('string', at, end);
    } else if (region === 'format') {
      push(/^\d+$/.test(word) ? 'number' : 'word', at, end);
    } else {
      const before = significant(tokens, tokens.length);
      const unit = TIME_UNITS.has(word) && (before?.text === 'LAST' || before?.kind === 'number');
      if (KEYWORDS.has(word) || unit) {
        push('keyword', at, end);
        if (word === 'BY' && startsSortClause(tokens, before)) region = 'format';
      } else {
        push(/^\d+$/.test(word) ? 'number' : 'word', at, end);
      }
    }
    at = end;
  }
  if (quote >= 0) tokens[quote] = { ...tokens[quote]!, open: true };
  classify(tokens);
  return tokens;
}

export type AtomKind =
  'connector' | 'not' | 'compare' | 'postfix' | 'open' | 'close' | 'operand' | 'sort';

/** 查询本体里的一个语法单位；`first`、`last` 是记号下标，一个引号串（含里面拆出的记号）算一个操作数 */
export interface Atom {
  readonly kind: AtomKind;
  readonly first: number;
  readonly last: number;
}

const CONNECTORS = new Set(['AND', 'OR']);

/** 把记号切成语法单位，到 `SORT` 为止：之后是排序表达式，不再按查询看 */
export function atomsOf(tokens: readonly Token[]): Atom[] {
  const atoms: Atom[] = [];
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]!;
    if (token.kind === 'space') continue;
    if (token.region === 'quoted' && token.kind === 'string' && token.text === '"') {
      let last = tokens.length - 1;
      for (let next = at + 1; next < tokens.length; next++) {
        const close = tokens[next]!;
        if (close.region === 'query' && close.kind === 'string' && close.text === '"') {
          last = next;
          break;
        }
      }
      atoms.push({ kind: 'operand', first: at, last });
      at = last;
      continue;
    }
    if (token.region !== 'query') continue;
    let kind: AtomKind = 'operand';
    if (token.kind === 'paren') kind = token.text === '(' ? 'open' : 'close';
    else if (token.kind === 'keyword') {
      if (token.text === 'LAST') continue;
      if (CONNECTORS.has(token.text)) kind = 'connector';
      else if (token.text === 'NOT') kind = 'not';
      else if (COMPARISONS.has(token.text) || TIME_COMPARISONS.has(token.text)) {
        kind = token.text === 'MISSING' || token.text === 'PRESENT' ? 'postfix' : 'compare';
      } else if (token.text === 'SORT') kind = 'sort';
    }
    atoms.push({ kind, first: at, last: at });
    if (kind === 'sort') break;
  }
  return atoms;
}

/** 第二遍：看前后的运算符认出裸词是字段还是值，再标出写成小写的关键字 */
function classify(tokens: Mutable<Token>[]): void {
  const atoms = atomsOf(tokens);
  atoms.forEach((atom, at) => {
    const token = tokens[atom.first]!;
    if (atom.kind !== 'operand' || token.kind !== 'word') return;
    const next = atoms[at + 1];
    const before = atoms[at - 1];
    const beforeText = before?.kind === 'compare' ? tokens[before.first]!.text : '';
    if (next?.kind === 'compare' || next?.kind === 'postfix') token.kind = 'field';
    else if (beforeText === 'HAS' || beforeText === 'IS') token.kind = 'string';
    else if (
      TIME_COMPARISONS.has(beforeText) ||
      ['GREATER', 'LESS', 'EQUAL'].includes(beforeText)
    ) {
      token.kind = 'number';
    }
  });
  for (const token of tokens) {
    if (token.kind === 'word' && token.region === 'query') {
      const upper = token.text.toUpperCase();
      if (token.text !== upper && KEYWORDS.has(upper)) token.lowercaseKeyword = true;
    }
  }
}
