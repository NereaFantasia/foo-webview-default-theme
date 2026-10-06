import type { MessageKey } from '../i18n/en.ts';
import {
  PLAYCOUNT_GROUP,
  QUERY_PRESETS,
  QUERY_SNIPPETS,
  type PresetGroup,
  type PresetId,
  type QueryPreset,
  type QuerySnippet,
  type SnippetId,
} from './queryPresets.ts';

// 查询菜单里的一行行：预设在前、写法在后，名字的文案与键盘怎么走。

export const PRESET_LABELS: Readonly<Record<PresetId, MessageKey>> = {
  highRated: 'query.highRated',
  unrated: 'query.unrated',
  recentlyAdded: 'query.recentlyAdded',
  recentlyPlayed: 'query.recentlyPlayed',
  frequent: 'query.frequent',
  neverPlayed: 'query.neverPlayed',
  lossless: 'query.lossless',
  hiRes: 'query.hiRes',
  long: 'query.long',
  missingTags: 'query.missingTags',
};

export const GROUP_LABELS: Readonly<Record<PresetGroup, MessageKey>> = {
  rating: 'query.groupRating',
  plays: 'query.groupPlays',
  quality: 'query.groupQuality',
  tags: 'query.groupTags',
};

export const SNIPPET_LABELS: Readonly<Record<SnippetId, MessageKey>> = {
  decade: 'query.decade',
  format: 'query.format',
  and: 'query.and',
  or: 'query.or',
  not: 'query.not',
};

export type QueryMenuEntry =
  | { readonly kind: 'preset'; readonly preset: QueryPreset; readonly disabled: boolean }
  | { readonly kind: 'snippet'; readonly snippet: QuerySnippet; readonly disabled: boolean };

export interface QueryMenuContext {
  /** 装没装 foo_playcount；null 是还没探出来，先当装了。 */
  readonly playcount: boolean | null;
  /** 框里已有查询：「两个条件都要」「任一个就行」这两条连接词才接得上。 */
  readonly connectable: boolean;
}

/** 菜单此刻列的各行，按显示顺序。 */
export function queryMenuEntries(context: QueryMenuContext): QueryMenuEntry[] {
  const presets = QUERY_PRESETS.map((preset): QueryMenuEntry => ({
    kind: 'preset',
    preset,
    disabled: preset.group === PLAYCOUNT_GROUP && context.playcount === false,
  }));
  const snippets = QUERY_SNIPPETS.map((snippet): QueryMenuEntry => ({
    kind: 'snippet',
    snippet,
    disabled: (snippet.id === 'and' || snippet.id === 'or') && !context.connectable,
  }));
  return [...presets, ...snippets];
}

/** 键盘从 `from` 往 `direction` 走到下一条能用的，到头了绕回另一头；一条能用的都没有时是 -1。 */
export function stepEntry(
  entries: readonly QueryMenuEntry[],
  from: number,
  direction: 1 | -1,
): number {
  const count = entries.length;
  // 还没有落点时，往下从第一条起、往上从最后一条起。
  const start = from >= 0 ? from : direction === 1 ? -1 : count;
  for (let step = 1; step <= count; step += 1) {
    const at = (((start + direction * step) % count) + count) % count;
    if (entries[at]?.disabled === false) return at;
  }
  return -1;
}
