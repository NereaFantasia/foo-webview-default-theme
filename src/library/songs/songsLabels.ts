import type { Translate } from '../../i18n/translate.ts';
import { PRESET_LABELS } from '../../track/queryMenuEntries.ts';
import type { PresetId } from '../../track/queryPresets.ts';
import { queryInputText } from '../../track/queryInput.ts';
import { SONG_FACETS, UNKNOWN_DECADE, type SongFacet } from './songsFacets.ts';
import type { SongsFilter } from './songsFilter.ts';

// 筛选写给人看的样子：条件行的标签、播放来源与新列表的名字、无匹配时的说明。

export type SongsConditionRef =
  | { readonly kind: 'preset'; readonly id: PresetId }
  | { readonly kind: 'facet'; readonly facet: SongFacet; readonly name: string };

export interface SongsCondition {
  /** 条件行里认标签用；取值里不会有换行。 */
  readonly key: string;
  readonly label: string;
  readonly ref: SongsConditionRef;
}

/** 年代一档写给人看：`1990s` 写成「1990 年代」，没写日期的写「未知」。 */
export function decadeLabel(name: string, t: Translate): string {
  return name === UNKNOWN_DECADE
    ? t('songs.decadeUnknown')
    : t('songs.decade', { decade: name.slice(0, 4) });
}

/** 生效的条件：先预设，再按流派、年代、艺术家的分面。框里的字不算条件，条件行里不列。 */
export function songsConditions(filter: SongsFilter, t: Translate): SongsCondition[] {
  const presets = [...filter.presets].map((id): SongsCondition => ({
    key: `preset\n${id}`,
    label: t(PRESET_LABELS[id]),
    ref: { kind: 'preset', id },
  }));
  const facets = SONG_FACETS.flatMap((facet) =>
    [...filter.facets[facet]].map((name): SongsCondition => ({
      key: `${facet}\n${name}`,
      label: facet === 'decade' ? decadeLabel(name, t) : name,
      ref: { kind: 'facet', facet, name },
    })),
  );
  return [...presets, ...facets];
}

/** 来源名称只采用当前模式的草稿。 */
function boxText(filter: SongsFilter): string {
  return queryInputText(filter).trim();
}

/**
 * 筛选的一句话说明，几样用「 · 」连起来：框里写的、各条件的名字。记进播放来源（播放栏写「歌曲 · 说明」），也是
 * 发送到新列表、建自动列表时列表名的后半。什么都不筛时是空串。
 */
export function songsLabel(filter: SongsFilter, t: Translate): string {
  return [boxText(filter), ...songsConditions(filter, t).map((one) => one.label)]
    .filter((part) => part !== '')
    .join(' · ');
}

/** 无匹配时的说明：「常听」「无损」与过滤词「live」一首都没命中。 */
export function noMatchText(filter: SongsFilter, t: Translate): string {
  const quoted = songsConditions(filter, t)
    .map((one) => t('songs.quoted', { text: one.label }))
    .join(t('songs.quoteSeparator'));
  const text = boxText(filter);
  const words = text === '' ? '' : t('songs.wordsCondition', { text });
  const conditions =
    quoted && words ? `${quoted}${t('songs.conditionsAnd')}${words}` : quoted || words;
  return t('songs.noMatchDetail', { conditions });
}
