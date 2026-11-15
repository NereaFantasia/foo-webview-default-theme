import { describe, expect, it } from 'vitest';
import { zhCN } from '../../../../src/i18n/zhCN.ts';
import { createTranslate } from '../../../../src/i18n/translate.ts';
import { referenceGroups } from '../../../../src/track/syntax/syntaxReference.ts';
import { PANEL_GROUPS } from '../../../../src/track/syntax/syntaxText.ts';
import { SYNTAX_ENTRIES } from '../../../../src/track/syntax/syntaxTable.ts';

const t = createTranslate(zhCN, {});

describe('referenceGroups', () => {
  it('不搜时组按固定先后出，常用在最前', () => {
    const groups = referenceGroups(t, '').map(({ group }) => group);
    expect(groups).toEqual([...PANEL_GROUPS]);
  });

  it('每个语法条目在面板里恰好出现一次，字段与函数都落在某个小节里', () => {
    const seen = referenceGroups(t, '')
      .filter(({ group }) => group !== 'common')
      .flatMap(({ sections }) => sections.flatMap(({ items }) => items))
      .map((item) => (item.kind === 'entry' ? `${item.entry.kind}.${item.entry.id}` : ''));
    expect(seen.sort()).toEqual(SYNTAX_ENTRIES.map((entry) => `${entry.kind}.${entry.id}`).sort());
    for (const entry of SYNTAX_ENTRIES) {
      if (entry.kind !== 'operator') expect(entry.topic, `${entry.kind}.${entry.id}`).toBeDefined();
    }
  });

  it('搜索只留命中的小节与组', () => {
    const groups = referenceGroups(t, '回放增益');
    const field = groups.find(({ group }) => group === 'field');
    expect(field?.sections.map(({ topic }) => topic)).toEqual(['gain']);
    expect(groups.some(({ group }) => group === 'common')).toBe(false);
  });

  it('搜索不分大小写，按名字、签名或说明匹配', () => {
    const names = (query: string) =>
      referenceGroups(t, query).flatMap(({ sections }) =>
        sections.flatMap(({ items }) =>
          items.map((item) => (item.kind === 'entry' ? item.entry.name : '')),
        ),
      );
    expect(names('greater')).toContain('GREATER');
    expect(names('$LEFT')).toContain('$left');
    expect(names('取 X 的前')).toContain('$left');
    expect(names('zzzz')).toEqual([]);
  });
});
