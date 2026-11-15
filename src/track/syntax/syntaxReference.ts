import type { Translate } from '../../i18n/translate.ts';
import { SNIPPET_LABELS } from '../queryLabels.ts';
import { QUERY_SNIPPETS, type QuerySnippet } from '../queryPresets.ts';
import { PANEL_GROUPS, entryDescription, panelGroupOf, type PanelGroup } from './syntaxText.ts';
import { SYNTAX_ENTRIES, type SyntaxEntry, type SyntaxTopic } from './syntaxTable.ts';

/** 参考面板里的一行：语法条目，或「常用」里整句的写法 */
export type ReferenceItem =
  | { readonly kind: 'entry'; readonly entry: SyntaxEntry }
  | { readonly kind: 'snippet'; readonly snippet: QuerySnippet };

/** 一组里的一小节：字段与函数按主题分，其余各组只有一节，`topic` 为 null */
export interface ReferenceSection {
  readonly topic: SyntaxTopic | null;
  readonly items: readonly ReferenceItem[];
}

export interface ReferenceGroup {
  readonly group: PanelGroup;
  readonly sections: readonly ReferenceSection[];
}

/** 小节在组里的先后 */
const TOPIC_ORDER: Readonly<Partial<Record<PanelGroup, readonly SyntaxTopic[]>>> = {
  field: ['tags', 'stats', 'file', 'audio', 'gain'],
  function: ['logic', 'read', 'text', 'path', 'math', 'time', 'extra'],
};

export function itemName(item: ReferenceItem): string {
  return item.kind === 'entry' ? item.entry.name : item.snippet.text.trim();
}

export function itemDescription(item: ReferenceItem, t: Translate): string {
  return item.kind === 'entry'
    ? (entryDescription(item.entry, t) ?? '')
    : t(SNIPPET_LABELS[item.snippet.id]);
}

/** 复制行尾小键要复制的：有示例复制示例，没有就复制签名 */
export function itemCopyText(item: ReferenceItem): string {
  if (item.kind === 'snippet') return item.snippet.text.trim();
  return item.entry.example ?? item.entry.signature;
}

function matches(item: ReferenceItem, needle: string, t: Translate): boolean {
  if (needle === '') return true;
  const haystack = [
    itemName(item),
    item.kind === 'entry' ? item.entry.signature : '',
    itemDescription(item, t),
  ];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

function sectionsOf(group: PanelGroup, entries: readonly SyntaxEntry[]): ReferenceSection[] {
  const topics = TOPIC_ORDER[group];
  const item = (entry: SyntaxEntry): ReferenceItem => ({ kind: 'entry', entry });
  if (!topics) return [{ topic: null, items: entries.map(item) }];
  return topics.map((topic) => ({
    topic,
    items: entries.filter((entry) => entry.topic === topic).map(item),
  }));
}

/**
 * 按使用的先后分好组，字段与函数再分小节；搜索词按名字、签名、说明做不分大小写的包含匹配，
 * 没有命中的小节与组都不出；`only` 给了就只列这几组（排序框只用字段与函数）
 */
export function referenceGroups(
  t: Translate,
  query: string,
  only?: readonly PanelGroup[],
): ReferenceGroup[] {
  const needle = query.trim().toLowerCase();
  const common: ReferenceItem[] = QUERY_SNIPPETS.map((snippet) => ({ kind: 'snippet', snippet }));
  return PANEL_GROUPS.filter((group) => !only || only.includes(group))
    .map((group): ReferenceGroup => {
      const sections: ReferenceSection[] =
        group === 'common'
          ? [{ topic: null, items: common }]
          : sectionsOf(
              group,
              SYNTAX_ENTRIES.filter((entry) => panelGroupOf(entry) === group),
            );
      return {
        group,
        sections: sections
          .map((section) => ({
            ...section,
            items: section.items.filter((item) => matches(item, needle, t)),
          }))
          .filter((section) => section.items.length > 0),
      };
    })
    .filter(({ sections }) => sections.length > 0);
}
