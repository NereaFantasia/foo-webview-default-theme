import { describe, expect, it } from 'vitest';
import { en } from '../../../../src/i18n/en.ts';
import { createTranslate } from '../../../../src/i18n/translate.ts';
import { zhCN } from '../../../../src/i18n/zhCN.ts';
import { diagnose } from '../../../../src/track/syntax/queryDiagnose.ts';
import { lexQuery } from '../../../../src/track/syntax/queryLexer.ts';
import {
  PANEL_GROUPS,
  entryDescription,
  issueText,
  panelGroupOf,
} from '../../../../src/track/syntax/syntaxText.ts';
import { SYNTAX_ENTRIES } from '../../../../src/track/syntax/syntaxTable.ts';

const tEn = createTranslate(en, {});
const tZh = createTranslate(zhCN, {});

describe('语法条目的文案', () => {
  it('每个条目中英文都有说明，且说明不是空的', () => {
    for (const entry of SYNTAX_ENTRIES) {
      expect(entryDescription(entry, tEn), `${entry.kind}.${entry.id} 英文`).toMatch(/\S/);
      expect(entryDescription(entry, tZh), `${entry.kind}.${entry.id} 中文`).toMatch(/\S/);
    }
  });

  it('同一种条目的标识不重复，语言包的键才对得上', () => {
    const keys = SYNTAX_ENTRIES.map((entry) => `${entry.kind}.${entry.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('每个条目都落进参考面板的某一组', () => {
    for (const entry of SYNTAX_ENTRIES) expect(PANEL_GROUPS).toContain(panelGroupOf(entry));
  });

  it('语言包里没有对不上条目的说明', () => {
    const known = new Set(SYNTAX_ENTRIES.map((entry) => `query.syntax.${entry.kind}.${entry.id}`));
    const described = Object.keys(en).filter((key) =>
      /^query\.syntax\.(operator|field|function|variable|misc)\./.test(key),
    );
    for (const key of described) expect(known.has(key), key).toBe(true);
  });
});

describe('issueText', () => {
  it('把问题写成一句话，带上出问题的那个词', () => {
    const text = 'artist IS x and title IS y';
    const [issue] = diagnose(lexQuery(text));
    expect(issue && issueText(issue, text, tEn)).toBe('Keywords must be uppercase: and');
    expect(issue && issueText(issue, text, tZh)).toBe('关键字要大写：and');
  });
});
