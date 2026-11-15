import type { Translate } from '../../i18n/translate.ts';
import { diagnose, pickIssue } from './queryDiagnose.ts';
import { lexQuery, type Region, type Token } from './queryLexer.ts';
import { entryDescription, issueText } from './syntaxText.ts';
import {
  FIELDS,
  FUNCTIONS,
  OPERATORS,
  VARIABLES,
  bareFieldName,
  type SyntaxEntry,
} from './syntaxTable.ts';

/** 说明行：先写光标所在的问题，没有问题就写光标所在记号的签名与一句说明 */
export interface Hint {
  readonly level: 'error' | 'warn' | 'info';
  readonly signature?: string;
  readonly text: string;
}

const OPERATOR_BY_NAME = new Map(OPERATORS.map((entry) => [entry.name, entry]));
const FIELD_BY_NAME = new Map(FIELDS.map((entry) => [bareFieldName(entry), entry]));
const FUNCTION_BY_NAME = new Map([...FUNCTIONS, ...VARIABLES].map((entry) => [entry.name, entry]));

function entryOf(token: Token, before: Token | undefined): SyntaxEntry | undefined {
  if (token.kind === 'keyword') {
    if (token.text === 'LAST' && before?.text === 'DURING')
      return OPERATOR_BY_NAME.get('DURING LAST');
    if (token.text === 'SORT' || token.text === 'BY') return OPERATOR_BY_NAME.get('SORT BY');
    return OPERATOR_BY_NAME.get(token.text);
  }
  if (token.kind === 'field') {
    const name = token.text.startsWith('%') ? token.text.replace(/%$/, '').slice(1) : token.text;
    return FIELD_BY_NAME.get(name);
  }
  if (token.kind === 'function') return FUNCTION_BY_NAME.get(token.text);
  return undefined;
}

/** 光标刚走过的那个记号对应的语法条目；没有对应的（普通文字、不认识的字段）给 undefined */
export function entryAt(tokens: readonly Token[], caret: number): SyntaxEntry | undefined {
  const significant = tokens.filter((token) => token.kind !== 'space');
  const at = significant.findIndex((token) => token.start < caret && caret <= token.end);
  const token = significant[at];
  return token && entryOf(token, significant[at - 1]);
}

export function hintAt(
  text: string,
  caret: number,
  t: Translate,
  region: Region = 'query',
): Hint | null {
  const tokens = lexQuery(text, region);
  const issue = pickIssue(diagnose(tokens, caret), caret);
  if (issue) return { level: issue.level, text: issueText(issue, text, t) };
  const entry = entryAt(tokens, caret);
  const description = entry && entryDescription(entry, t);
  if (!entry || !description) return null;
  return { level: 'info', signature: entry.signature, text: description };
}
