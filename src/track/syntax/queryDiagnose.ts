import { atomsOf, type Atom, type Token } from './queryLexer.ts';

// 本地结构诊断：仅提示不阻断提交；查询有效性以宿主 `library.query` 返回为准，宿主不给出错位置，
// 此处可定位的位置仅包含括号、引号、百分号与缺少操作数的运算符

export type IssueCode =
  | 'unclosedParen'
  | 'unmatchedParen'
  | 'unclosedString'
  | 'unclosedField'
  | 'lowercaseKeyword'
  | 'unknownFunction'
  | 'missingOperand';

export interface Issue {
  readonly code: IssueCode;
  readonly level: 'error' | 'warn';
  readonly start: number;
  readonly end: number;
}

/** 光标正在这个记号里或紧挨着它末尾：还在输入，不当错误报 */
function typing(token: Token, caret: number | undefined): boolean {
  return caret !== undefined && caret > token.start && caret <= token.end;
}

function operandIssues(atoms: readonly Atom[], tokens: readonly Token[]): Issue[] {
  const issues: Issue[] = [];
  const report = (atom: Atom, atEnd: boolean) => {
    const token = tokens[atom.first]!;
    issues.push({
      code: 'missingOperand',
      // 写到一半的结尾只提示，中间缺了才算错
      level: atEnd ? 'warn' : 'error',
      start: token.start,
      end: tokens[atom.last]!.end,
    });
  };
  const needsOperandAfter = new Set(['connector', 'not', 'compare']);
  atoms.forEach((atom, at) => {
    const next = atoms[at + 1];
    const before = atoms[at - 1];
    if (needsOperandAfter.has(atom.kind)) {
      if (!next) report(atom, true);
      else if (next.kind === 'connector' || next.kind === 'close' || next.kind === 'sort') {
        report(atom, false);
      }
    }
    if (atom.kind === 'connector' && (!before || before.kind === 'open')) report(atom, false);
    if (atom.kind === 'compare' || atom.kind === 'postfix') {
      const field = before && (before.kind === 'operand' || before.kind === 'close');
      if (!field) report(atom, false);
    }
  });
  return issues;
}

/** 所有问题，按位置排；`caret` 给了就不报光标所在记号的小问题，免得边打边闪 */
export function diagnose(tokens: readonly Token[], caret?: number): Issue[] {
  const issues: Issue[] = [];
  const open: Token[] = [];
  const last = tokens[tokens.length - 1];
  for (const token of tokens) {
    if (token.kind === 'paren' && token.region === 'query') {
      if (token.text === '(') open.push(token);
      else if (open.pop() === undefined) {
        issues.push({ code: 'unmatchedParen', level: 'error', start: token.start, end: token.end });
      }
    }
    if (token.kind === 'string' && token.open && last) {
      issues.push({ code: 'unclosedString', level: 'error', start: token.start, end: last.end });
    }
    if (token.kind === 'field' && token.open && !typing(token, caret)) {
      issues.push({ code: 'unclosedField', level: 'error', start: token.start, end: token.end });
    }
    if (token.lowercaseKeyword && !typing(token, caret)) {
      issues.push({ code: 'lowercaseKeyword', level: 'warn', start: token.start, end: token.end });
    }
    if (token.unknown && !typing(token, caret)) {
      issues.push({ code: 'unknownFunction', level: 'warn', start: token.start, end: token.end });
    }
  }
  for (const token of open) {
    issues.push({ code: 'unclosedParen', level: 'error', start: token.start, end: token.end });
  }
  issues.push(...operandIssues(atomsOf(tokens), tokens));
  return issues.sort((a, b) => a.start - b.start);
}

/** 说明行写哪一个：光标所在的优先，其次第一个错误，再次第一个提示 */
export function pickIssue(issues: readonly Issue[], caret: number): Issue | undefined {
  return (
    issues.find((issue) => issue.start <= caret && caret <= issue.end) ??
    issues.find((issue) => issue.level === 'error') ??
    issues[0]
  );
}
