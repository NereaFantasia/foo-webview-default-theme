import { atomsOf, lexQuery, type Region, type Token } from './queryLexer.ts';
import {
  FIELDS,
  FUNCTIONS,
  OPERATORS,
  VARIABLES,
  bareFieldName,
  type SyntaxEntry,
} from './syntaxTable.ts';

// 补全：按光标前面的语法状态挑选候选并将选中项填入文本；纯函数，不依赖界面

/** 光标前面的查询走到了哪一步：下一个该是什么 */
export type Expect = 'start' | 'afterField' | 'afterOperator' | 'afterCondition' | 'sort';

export interface Candidate {
  readonly entry: SyntaxEntry;
  /** 落进文字里的那一段 */
  readonly insert: string;
  /** 落进去之后选中的一截在 `insert` 里的起止；不给时光标落在末尾 */
  readonly select?: readonly [number, number];
  /** 前面是字就先补一个空格 */
  readonly spaced: boolean;
}

export interface Completion {
  /** 被替换的一段 */
  readonly from: number;
  readonly to: number;
  readonly items: readonly Candidate[];
}

export interface Filled {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const LIMIT = 30;

function expectBefore(tokens: readonly Token[], limit: number): Expect {
  const before = tokens.filter((token) => token.end <= limit);
  const atoms = atomsOf(before);
  let state: Expect = 'start';
  for (const atom of atoms) {
    if (atom.kind === 'connector' || atom.kind === 'not' || atom.kind === 'open') state = 'start';
    else if (atom.kind === 'close' || atom.kind === 'postfix') state = 'afterCondition';
    else if (atom.kind === 'compare') state = 'afterOperator';
    else if (atom.kind === 'sort') return 'sort';
    else if (state === 'start') state = 'afterField';
    else state = 'afterCondition';
  }
  return state;
}

/** 光标在引号里或排序表达式里：这里按 Title Formatting 写，字段带 `%` */
function insideQuotes(tokens: readonly Token[], caret: number): boolean {
  const at = tokens.find((token) => token.start < caret && caret <= token.end);
  return at?.region === 'quoted' || at?.region === 'format';
}

function startsWith(name: string, prefix: string): boolean {
  return name.toLowerCase().startsWith(prefix.toLowerCase());
}

function pick(
  entries: readonly SyntaxEntry[],
  prefix: string,
  name: (entry: SyntaxEntry) => string,
) {
  return entries.filter((entry) => startsWith(name(entry), prefix));
}

function plain(entry: SyntaxEntry, spaced = false): Candidate {
  return { entry, insert: entry.insert, select: entry.select, spaced };
}

/** 查询本体里补一个字段：不带 `%`，名字里有空格要加引号 */
function bareField(entry: SyntaxEntry): Candidate {
  const name = bareFieldName(entry);
  const insert = /\s/.test(name) ? `"${name}"` : name;
  return { entry, insert, spaced: true };
}

/** 查询本体里补函数：函数只能写在引号里的字段位置，替用户包上引号 */
function quotedFunction(entry: SyntaxEntry): Candidate {
  const select = entry.select && ([entry.select[0] + 1, entry.select[1] + 1] as const);
  return { entry, insert: `"${entry.insert}"`, select, spaced: true };
}

function operators(...groups: readonly string[]): readonly SyntaxEntry[] {
  return OPERATORS.filter((entry) => groups.includes(entry.group));
}

function wordCandidates(expect: Expect, prefix: string): Candidate[] {
  const upper = prefix.toUpperCase();
  const keyword = (entries: readonly SyntaxEntry[]) =>
    entries.filter((entry) => entry.name.startsWith(upper)).map((entry) => plain(entry, true));
  if (expect === 'start') {
    const fields = pick(FIELDS, prefix, bareFieldName).map(bareField);
    return [...fields, ...keyword(operators('connect').filter((entry) => entry.id === 'not'))];
  }
  if (expect === 'afterField') return keyword(operators('condition', 'time'));
  if (expect === 'afterCondition') {
    return keyword([
      ...operators('connect').filter((entry) => entry.id !== 'not'),
      ...operators('sort'),
    ]);
  }
  return [];
}

/**
 * 光标处的候选；`manual` 为主动触发（`Ctrl+Space`），无前缀时同样返回候选，
 * 否则仅在前缀至少一字、或光标紧跟字段与完整条件时触发；
 * `region` 为 `format` 时整段作为 Title Formatting 解析，仅补全 `%字段%` 与 `$函数`
 */
export function completeAt(
  text: string,
  caret: number,
  manual = false,
  region: Region = 'query',
): Completion | null {
  const tokens = lexQuery(text, region);
  const current = tokens.find(
    (token) => token.kind !== 'space' && token.start < caret && caret <= token.end,
  );
  const result = (from: number, to: number, items: readonly Candidate[]): Completion | null =>
    items.length === 0 ? null : { from, to, items: items.slice(0, LIMIT) };

  if (current?.kind === 'field' && text[current.start] === '%') {
    const prefix = text.slice(current.start + 1, caret).replace(/%$/, '');
    const items = pick(FIELDS, prefix, bareFieldName).map((entry) => plain(entry));
    // 字段已经写全、候选只剩它自己：没有可补的，浮层不该留在原地盖住后面的控件
    const written = text.slice(current.start, current.end);
    if (!current.open && items.length === 1 && items[0]!.entry.name === written) return null;
    return result(current.start, current.end, items);
  }
  if (current?.kind === 'function') {
    const prefix = text.slice(current.start + 1, caret);
    const entries = pick(
      current.region === 'query' ? FUNCTIONS : [...FUNCTIONS, ...VARIABLES],
      prefix,
      (entry) => entry.name.slice(1),
    );
    const wrap = current.region === 'query';
    return result(
      current.start,
      current.end,
      entries.map((entry) => (wrap ? quotedFunction(entry) : plain(entry))),
    );
  }
  if (current && current.region !== 'query') return null;
  if (current && (current.kind === 'paren' || current.text === '"')) return null;

  if (current) {
    const prefix = text.slice(current.start, caret);
    const items = wordCandidates(expectBefore(tokens, current.start), prefix);
    // 已经写全了、候选只剩它自己：没有可补的
    if (items.length === 1 && items[0]!.entry.name === prefix) return null;
    return result(current.start, current.end, items);
  }
  // 排序框里光标不在任何记号上：只有主动要时给 `%字段%`，裸词在这里不是字段
  if (region === 'format')
    return manual
      ? result(
          caret,
          caret,
          FIELDS.map((entry) => plain(entry)),
        )
      : null;
  const expect = expectBefore(tokens, caret);
  const afterSpace = caret === 0 || /\s/.test(text[caret - 1]!);
  if (!afterSpace && !manual) return null;
  if (expect === 'start' && !manual) return null;
  return result(caret, caret, wordCandidates(expect, ''));
}

/** 把选中的一项落进文字里；该补空格的补上，返回新文字与要选中的区间 */
export function applyCompletion(text: string, completion: Completion, item: Candidate): Filled {
  const before = text.slice(0, completion.from);
  const after = text.slice(completion.to);
  const lead = item.spaced && before !== '' && !/[\s(]$/.test(before) ? ' ' : '';
  const base = before.length + lead.length;
  const [from, to] = item.select ?? [item.insert.length, item.insert.length];
  return { text: `${before}${lead}${item.insert}${after}`, start: base + from, end: base + to };
}

/**
 * 参考面板插入条目：将条目填入当前选区；引号与格式表达式内原样插入；查询主体中字段写为裸名、
 * 函数包裹引号，已存在完整条件时追加 `AND` 前缀；`region` 为 `format` 时整段作为 Title Formatting 原样插入
 */
export function insertEntry(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  entry: SyntaxEntry,
  region: Region = 'query',
): Filled {
  const tokens = lexQuery(text, region);
  let item: Candidate = plain(entry);
  let lead = '';
  if (region === 'query' && !insideQuotes(tokens, selectionStart)) {
    const expect = expectBefore(tokens, selectionStart);
    if (entry.kind === 'field') item = bareField(entry);
    else if (entry.kind === 'function' || entry.kind === 'variable') item = quotedFunction(entry);
    else item = plain(entry, true);
    const isCondition = entry.kind === 'field' || entry.kind === 'function';
    if (isCondition && expect === 'afterCondition') lead = 'AND ';
  }
  const select =
    item.select && ([item.select[0] + lead.length, item.select[1] + lead.length] as const);
  const completion: Completion = { from: selectionStart, to: selectionEnd, items: [] };
  const next = {
    ...item,
    insert: `${lead}${item.insert}`,
    select,
    spaced: item.spaced || lead !== '',
  };
  return applyCompletion(text, completion, next);
}
