import { describe, expect, it } from 'vitest';
import {
  changelogVersionState,
  notesFor,
  readChangelog,
  type ChangelogCatalog,
} from '../../../src/update/changelog.ts';

function log(entries: unknown, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 1, entries, ...fields });
}

/** 写进日志的一页：只有标题和一条修复。 */
function page(title: string, fix = '修复'): unknown {
  return { title, fixes: [fix] };
}

/** `page` 读出来的样子。 */
function read(title: string, fix = '修复') {
  return { title, summary: '', items: [], fixes: [fix] };
}

describe('日志版本状态', () => {
  const catalog: ChangelogCatalog = {
    candidates: ['0.5.0', '0.6.0', '0.7.0', '0.8.0'].map((version) => ({
      version,
      stone: false,
      release: '',
      releaseSha256: 'a'.repeat(64),
      upgradeFrom: version === '0.7.0' ? '>=0.6.0' : '>=0.1.0',
      requires: { foo_ui_webview2: version === '0.6.0' ? '>=3.0.0' : '>=2.0.0' },
      requiresLoader: version === '0.8.0' ? 2 : 1,
    })),
    context: { current: '0.1.0', plugin: '2.0.0', loader: 1, revoked: ['0.2.0'], failed: [] },
    pending: '0.3.0',
    target: '0.5.0',
  };
  it.each([
    ['0.1.0', 'current'],
    ['0.2.0', 'revoked'],
    ['0.3.0', 'pending'],
    ['0.4.0', 'included'],
    ['0.5.0', 'available'],
    ['0.6.0', 'plugin'],
    ['0.7.0', 'manual'],
    ['0.8.0', 'manual'],
    ['0.9.0', 'unavailable'],
    ['0.0.9', 'old'],
  ] as const)('%s 是 %s', (version, expected) => {
    expect(changelogVersionState(version, catalog)).toBe(expected);
  });
  it('当前版本、pending 和撤回优先于候选目标', () => {
    expect(changelogVersionState('0.1.0', { ...catalog, target: '0.1.0' })).toBe('current');
    expect(changelogVersionState('0.3.0', { ...catalog, target: '0.3.0' })).toBe('pending');
    expect(changelogVersionState('0.2.0', { ...catalog, target: '0.2.0' })).toBe('revoked');
  });
});

describe('readChangelog', () => {
  it('按版本从高到低排列，日期可选', () => {
    const entries = readChangelog(
      log([
        { version: '0.1.0', notes: { 'zh-CN': page('首发') } },
        { version: '0.10.0', date: '2026-11-01', notes: { en: page('Later', 'Fixed') } },
        {
          version: '0.2.0',
          date: '2026-10-10',
          notes: { en: page('Fixes', 'Fixed'), 'zh-CN': page('修复') },
        },
      ]),
    );
    expect(entries?.map((entry) => [entry.version, entry.date])).toEqual([
      ['0.10.0', '2026-11-01'],
      ['0.2.0', '2026-10-10'],
      ['0.1.0', null],
    ]);
    expect(entries?.[2]?.notes).toEqual({ 'zh-CN': read('首发') });
  });

  it('读出标题、摘要、亮点与修复，去掉首尾空白', () => {
    const entries = readChangelog(
      log([
        {
          version: '0.2.0',
          notes: {
            'zh-CN': {
              title: ' 更新，由你决定 ',
              summary: '现在可以自己选择主题怎么更新。',
              items: [
                { icon: 'update', title: '三种更新方式', text: '在 设置 › 关于 › 更新方式 里选。' },
              ],
              fixes: ['切换配色时界面不再闪一下'],
            },
          },
        },
      ]),
    );
    expect(entries?.[0]?.notes['zh-CN']).toEqual({
      title: '更新，由你决定',
      summary: '现在可以自己选择主题怎么更新。',
      items: [{ icon: 'update', title: '三种更新方式', text: '在 设置 › 关于 › 更新方式 里选。' }],
      fixes: ['切换配色时界面不再闪一下'],
    });
  });

  it('格式不对或顶层结构不对时返回 null', () => {
    expect(readChangelog(log([], { format: 2 }))).toBeNull();
    expect(readChangelog(JSON.stringify({ format: 1, entries: {} }))).toBeNull();
    expect(readChangelog('<html>登录</html>')).toBeNull();
  });

  it('丢掉坏版本号与重复的条目，坏日期按没写处理', () => {
    const entries = readChangelog(
      log([
        { version: 'v0.2.0', notes: { en: page('x') } },
        { version: '0.2.0-beta.1', notes: { en: page('x') } },
        { version: '0.2.0', date: '2026-13-01', notes: { en: page('first') } },
        { version: '0.2.0', notes: { en: page('second') } },
        { version: '0.3.0' },
        '不是对象',
      ]),
    );
    expect(entries).toEqual([{ version: '0.2.0', date: null, notes: { en: read('first') } }]);
  });

  it('缺标题、摘要亮点修复全空、或者写成别的结构的语言不收', () => {
    const entries = readChangelog(
      log([
        {
          version: '0.2.0',
          notes: {
            'zh-CN': { summary: '没有标题' },
            en: { title: 'Empty', summary: '  ', items: [], fixes: [' '] },
            ja: ['旧格式的列表'],
            fr: page('Corrections', 'x'),
            'bad tag': page('丢掉'),
          },
        },
      ]),
    );
    expect(entries?.[0]?.notes).toEqual({ fr: read('Corrections', 'x') });
  });

  it('亮点缺标题时丢掉这一条，不认识的图标按 sparkle', () => {
    const entries = readChangelog(
      log([
        {
          version: '0.2.0',
          notes: {
            en: {
              title: 'Icons',
              items: [
                { icon: 'rocket', title: 'New icon', text: 'x' },
                { icon: 'log', text: 'No title' },
                { title: 'Only a title' },
                'not an item',
              ],
            },
          },
        },
      ]),
    );
    expect(entries?.[0]?.notes.en?.items).toEqual([
      { icon: 'sparkle', title: 'New icon', text: 'x' },
      { icon: 'sparkle', title: 'Only a title', text: '' },
    ]);
  });

  it('超长截断，超量截掉', () => {
    const fixes = ['  ', 3, ...Array.from({ length: 150 }, (_, at) => `第 ${at} 条`)];
    const items = Array.from({ length: 10 }, (_, at) => ({
      icon: 'fix',
      title: at === 0 ? 't'.repeat(100) : `亮点 ${at}`,
      text: 'x'.repeat(1500),
    }));
    const entries = readChangelog(
      log([
        {
          version: '0.2.0',
          notes: {
            'zh-CN': { title: '标'.repeat(100), summary: '摘'.repeat(700), items, fixes },
            en: { title: 'Long fix', fixes: ['y'.repeat(1500)] },
          },
        },
      ]),
    );
    const zh = entries?.[0]?.notes['zh-CN'];
    expect(zh?.title).toBe('标'.repeat(80));
    expect(zh?.summary).toBe('摘'.repeat(600));
    expect(zh?.items).toHaveLength(8);
    expect(zh?.items[0]).toEqual({ icon: 'fix', title: 't'.repeat(80), text: 'x'.repeat(1000) });
    expect(zh?.fixes).toHaveLength(100);
    expect(zh?.fixes[0]).toBe('第 0 条');
    expect(entries?.[0]?.notes.en?.fixes).toEqual(['y'.repeat(1000)]);
  });

  it('版本数超过上限时截掉后面的', () => {
    const entries = Array.from({ length: 1200 }, (_, at) => ({
      version: `0.0.${at}`,
      notes: { en: page('x') },
    }));
    expect(readChangelog(log(entries))).toHaveLength(1000);
  });
});

describe('notesFor', () => {
  const zh = read('修复');
  const en = read('Fixes', 'Fixed');
  const both = { version: '0.2.0', date: null, notes: { en, 'zh-CN': zh } };

  it('优先取界面语言', () => {
    expect(notesFor(both, 'zh-CN')).toEqual({ notes: zh, language: 'zh-CN' });
    expect(notesFor(both, 'en')).toEqual({ notes: en, language: 'en' });
  });

  it('缺界面语言时整页改用另一种内置语言，再缺取第一种', () => {
    expect(notesFor({ ...both, notes: { en } }, 'zh-CN')).toEqual({ notes: en, language: 'en' });
    const ja = read('修正');
    expect(notesFor({ ...both, notes: { ja } }, 'en')).toEqual({ notes: ja, language: 'ja' });
    expect(notesFor({ ...both, notes: {} }, 'en')).toEqual({ notes: null, language: null });
  });
});

describe('readChangelog 的规范化', () => {
  it('语言标签按规范大小写读，大小写不同的同一种语言只留第一份', () => {
    const entries = readChangelog(
      log([
        {
          version: '0.2.0',
          notes: { 'zh-cn': page('小写'), 'zh-CN': page('规范'), EN: page('Upper', 'Fixed') },
        },
      ]),
    );
    const entry = entries?.[0];
    expect(entry?.notes).toEqual({ 'zh-CN': read('小写'), en: read('Upper', 'Fixed') });
    expect(entry && notesFor(entry, 'zh-CN').language).toBe('zh-CN');
  });

  it('按码点截断，不切开 emoji', () => {
    const entries = readChangelog(
      log([
        {
          version: '0.2.0',
          notes: { en: { title: '😀'.repeat(100), fixes: ['🎵'.repeat(1001)] } },
        },
      ]),
    );
    const notes = entries?.[0]?.notes.en;
    expect(notes?.title).toBe('😀'.repeat(80));
    expect(notes?.fixes).toEqual(['🎵'.repeat(1000)]);
  });

  it('日历上不存在的日期当作没写', () => {
    const entries = readChangelog(
      log([
        { version: '0.3.0', date: '2028-02-29', notes: { en: page('Leap') } },
        { version: '0.2.0', date: '2026-02-31', notes: { en: page('Never') } },
      ]),
    );
    expect(entries?.map((entry) => entry.date)).toEqual(['2028-02-29', null]);
  });
});
