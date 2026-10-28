import type { MessageKey } from '../i18n/en.ts';
import type { PresetId, SnippetId } from './queryPresets.ts';

// 查询预设与语法示例的名字：筛选浮层的「常用」、条件片与搜索框末尾的菜单共用

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

export const SNIPPET_LABELS: Readonly<Record<SnippetId, MessageKey>> = {
  decade: 'query.decade',
  format: 'query.format',
  and: 'query.and',
  or: 'query.or',
  not: 'query.not',
};
