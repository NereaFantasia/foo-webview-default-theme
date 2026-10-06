import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readChangelog } from '../../../src/update/changelog.ts';
import {
  changelogJson,
  parseChangelogSource,
  releaseNotes,
} from '../../../src/update/changelogSource.ts';

const SOURCE = [
  '# 更新内容',
  '',
  '导语不解析。',
  '',
  '## 0.2.0 - 2026-10-25',
  '',
  '### zh-CN',
  '',
  '#### 更新，由你决定',
  '',
  '现在可以自己选择主题怎么更新，',
  '每个版本改了什么也能直接看到。',
  '',
  '- [update] **三种更新方式** 关闭、提醒、自动，',
  '  在 设置 › 关于 里选。',
  '- [log] **更新内容**',
  '',
  '##### 修复',
  '',
  '- 切换配色时界面不再闪一下',
  '',
  '### en',
  '',
  '#### Updates, your way',
  '',
  'Choose how the theme updates,',
  'and see what changed.',
  '',
  '##### Fixes',
  '',
  '- No flash when switching colors',
  '',
  '## 0.1.0',
  '',
  '### zh-CN',
  '',
  '#### 首发',
  '',
  '第一个版本。',
  '',
].join('\n');

const ZH_SUMMARY = '现在可以自己选择主题怎么更新，每个版本改了什么也能直接看到。';
const ZH_ITEM = '关闭、提醒、自动，在 设置 › 关于 里选。';

/** 一个只有一页中文的版本，八行。 */
function version(value: string): string[] {
  return [`## ${value}`, '', '### zh-CN', '', '#### 标题', '', '摘要', ''];
}
/** 0.1.0 的中文页里接上 `lines`，第一行是第 5 行。 */
function page(...lines: string[]): string {
  return ['## 0.1.0', '', '### zh-CN', '', ...lines].join('\n');
}

describe('parseChangelogSource', () => {
  it('读出版本、日期、各语言的页，折行接回一行，修复小节标题另存', () => {
    expect(parseChangelogSource(SOURCE)).toEqual([
      {
        version: '0.2.0',
        date: '2026-10-25',
        notes: {
          'zh-CN': {
            title: '更新，由你决定',
            summary: ZH_SUMMARY,
            items: [
              { icon: 'update', title: '三种更新方式', text: ZH_ITEM },
              { icon: 'log', title: '更新内容', text: '' },
            ],
            fixes: ['切换配色时界面不再闪一下'],
          },
          en: {
            title: 'Updates, your way',
            summary: 'Choose how the theme updates, and see what changed.',
            items: [],
            fixes: ['No flash when switching colors'],
          },
        },
        fixesTitles: { 'zh-CN': '修复', en: 'Fixes' },
      },
      {
        version: '0.1.0',
        date: null,
        notes: { 'zh-CN': { title: '首发', summary: '第一个版本。', items: [], fixes: [] } },
        fixesTitles: {},
      },
    ]);
  });

  it('标题按码点计长度，80 个 emoji 不算超长', () => {
    const [entry] = parseChangelogSource(page(`#### ${'😀'.repeat(80)}`, '', '摘要'));
    expect(entry?.notes['zh-CN']?.title).toBe('😀'.repeat(80));
  });

  const invalid: [string, string, number, string][] = [
    ['图标不认识', page('#### 标题', '', '- [rocket] **亮点** 说明'), 7, '图标 rocket'],
    ['语言标签不规范', ['## 0.1.0', '', '### zh-cn'].join('\n'), 3, 'zh-CN'],
    ['日期不存在', ['## 0.1.0 - 2026-02-31'].join('\n'), 1, '日期'],
    ['版本不是稳定版', ['## 0.1.0-beta.1'].join('\n'), 1, '稳定版'],
    ['版本重复', [...version('0.1.0'), ...version('0.1.0')].join('\n'), 9, '两次'],
    ['版本没有从高到低', [...version('0.1.0'), ...version('0.2.0')].join('\n'), 9, '从高到低'],
    ['缺页标题', page('摘要'), 5, '四级页标题'],
    ['一页只有标题', page('#### 标题'), 3, '至少写一项'],
    ['一种语言都没写', ['## 0.2.0', '', ...version('0.1.0')].join('\n'), 1, '一种语言'],
    [
      '两个修复小节',
      page('#### 标题', '', '##### 修复', '', '- a', '', '##### 修复'),
      11,
      '修复小节',
    ],
    ['两段摘要', page('#### 标题', '', '第一段', '', '第二段'), 9, '一段'],
    ['亮点写在修复之前以外的格式', page('#### 标题', '', '- 没写图标'), 7, '[图标]'],
    ['标题超长', page(`#### ${'标'.repeat(81)}`, '', '摘要'), 5, '80'],
    ['用了别的列表符号', page('#### 标题', '', '* 星号'), 7, '- 开头'],
    ['续行前面没有亮点', page('#### 标题', '', '  缩进'), 7, '续行'],
  ];
  it.each(invalid)('%s时报错并指出行号', (_, source, line, fragment) => {
    expect(() => parseChangelogSource(source)).toThrow(`第 ${line} 行`);
    expect(() => parseChangelogSource(source)).toThrow(fragment);
  });

  it('仓库根的 CHANGELOG.md 能通过校验，0.1.0 写了中英两页', () => {
    const source = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const first = parseChangelogSource(source).find((entry) => entry.version === '0.1.0');
    expect(Object.keys(first?.notes ?? {}).sort()).toEqual(['en', 'zh-CN']);
  });
});

describe('changelogJson', () => {
  it('只收到指定版本为止的条目，没写日期的不带 date，读回与源一致', () => {
    const entries = parseChangelogSource(SOURCE);
    const older = JSON.parse(changelogJson(entries, '0.1.0')) as {
      entries: Record<string, unknown>[];
    };
    expect(older.entries.map((entry) => entry.version)).toEqual(['0.1.0']);
    expect(older.entries[0]).not.toHaveProperty('date');
    expect(older.entries[0]).not.toHaveProperty('fixesTitles');
    const all = readChangelog(changelogJson(entries, '0.2.0'));
    expect(all?.map((entry) => [entry.version, entry.date])).toEqual([
      ['0.2.0', '2026-10-25'],
      ['0.1.0', null],
    ]);
  });
});

describe('releaseNotes', () => {
  it('每种语言一段 Markdown，zh-CN、en 排在前面', () => {
    const [latest] = parseChangelogSource(SOURCE);
    if (!latest) throw new Error('缺条目');
    const notes = releaseNotes(latest);
    expect(Object.keys(notes)).toEqual(['zh-CN', 'en']);
    expect(notes['zh-CN']).toBe(
      [
        '### 更新，由你决定',
        '',
        ZH_SUMMARY,
        '',
        `- **三种更新方式** ${ZH_ITEM}`,
        '- **更新内容**',
        '',
        '#### 修复',
        '',
        '- 切换配色时界面不再闪一下',
      ].join('\n'),
    );
    const [mixed] = parseChangelogSource(
      [
        '## 0.1.0',
        '',
        '### ja',
        '',
        '#### 初版',
        '',
        '説明',
        '',
        '### en',
        '',
        '#### First',
        '',
        'Text',
      ].join('\n'),
    );
    if (!mixed) throw new Error('缺条目');
    expect(Object.keys(releaseNotes(mixed))).toEqual(['en', 'ja']);
  });
});
