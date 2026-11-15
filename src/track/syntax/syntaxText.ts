import { en, type MessageKey } from '../../i18n/en.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { Issue } from './queryDiagnose.ts';
import type { SyntaxEntry, SyntaxGroup } from './syntaxTable.ts';

// 语法条目与诊断的文案：键由条目的 kind 与 id 拼出，拼出来的键不一定在语言包里，所以先校验再取

function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** 条目的一句说明；语言包里没有这一条时给 null */
export function entryDescription(entry: SyntaxEntry, t: Translate): string | null {
  const key = `query.syntax.${entry.kind}.${entry.id}`;
  return isMessageKey(key) ? t(key) : null;
}

/** 参考面板里的分组，按使用的先后；`common` 由面板自己组装 */
export type PanelGroup = 'common' | 'field' | 'condition' | 'connect' | 'function' | 'sort';

export const PANEL_GROUPS: readonly PanelGroup[] = [
  'common',
  'field',
  'condition',
  'connect',
  'function',
  'sort',
];

const GROUP_OF: Readonly<Record<SyntaxGroup, PanelGroup>> = {
  field: 'field',
  condition: 'condition',
  time: 'condition',
  connect: 'connect',
  sort: 'sort',
  function: 'function',
  variable: 'function',
  other: 'function',
};

export function panelGroupOf(entry: SyntaxEntry): PanelGroup {
  return GROUP_OF[entry.group];
}

const ISSUE_KEYS = {
  unclosedParen: 'query.syntax.issue.unclosedParen',
  unmatchedParen: 'query.syntax.issue.unmatchedParen',
  unclosedString: 'query.syntax.issue.unclosedString',
  unclosedField: 'query.syntax.issue.unclosedField',
  lowercaseKeyword: 'query.syntax.issue.lowercaseKeyword',
  unknownFunction: 'query.syntax.issue.unknownFunction',
  missingOperand: 'query.syntax.issue.missingOperand',
} as const satisfies Record<Issue['code'], MessageKey>;

/** 诊断问题的一句话；`text` 是整段查询，用来取出出问题的那个词 */
export function issueText(issue: Issue, text: string, t: Translate): string {
  const word = text.slice(issue.start, issue.end);
  return t(ISSUE_KEYS[issue.code], { word, name: word });
}
