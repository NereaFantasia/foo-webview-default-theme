import type { MessageKey } from '../../../i18n/en.ts';
import type { FacetChip } from '../../../kit/FacetConditions.tsx';
import {
  ONLINE_FACETS,
  ONLINE_PRESET_LABELS,
  ONLINE_PRESETS,
  toggleOnlineFacet,
  toggleOnlinePreset,
  type OnlineFacet,
  type OnlineTrackFilter,
} from './onlineTrackFilter.ts';

/** 音质分面档位到国际化文案键的映射表 */
const QUALITY_LABELS: Readonly<Record<string, MessageKey>> = {
  '128k': 'online.quality.128k',
  '320k': 'online.quality.320k',
  flac: 'online.quality.flac',
  flac24bit: 'online.quality.flac24bit',
};

/** 解析分面候选值的显示文本：艺人与专辑保持原值，音质映射为国际化标签 */
export function facetValueLabel(
  facet: OnlineFacet,
  value: string,
  t: (key: MessageKey) => string,
): string {
  const key = facet === 'quality' ? QUALITY_LABELS[value] : undefined;
  return key ? t(key) : value;
}

/** 将筛选条件映射为标签片列表。键格式为 preset:<id> 或 <分面>:<取值>，支持取值本身包含冒号 */
export function onlineFilterChips(
  filter: OnlineTrackFilter,
  t: (key: MessageKey) => string,
): readonly FacetChip[] {
  const presets = ONLINE_PRESETS.filter((preset) => filter.presets.has(preset)).map((preset) => ({
    key: `preset:${preset}`,
    label: t(ONLINE_PRESET_LABELS[preset]),
  }));
  const facets = ONLINE_FACETS.flatMap((facet) =>
    [...filter.facets[facet]].map((value) => ({
      key: `${facet}:${value}`,
      label: facetValueLabel(facet, value, t),
    })),
  );
  return [...presets, ...facets];
}

/** 移除指定的条件标签片并返回新筛选状态；未匹配到有效条件时返回原状态 */
export function removeOnlineChip(filter: OnlineTrackFilter, key: string): OnlineTrackFilter {
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  const value = key.slice(at + 1);
  if (kind === 'preset') {
    const preset = ONLINE_PRESETS.find((one) => one === value);
    return preset && filter.presets.has(preset) ? toggleOnlinePreset(filter, preset) : filter;
  }
  const facet: OnlineFacet | undefined = ONLINE_FACETS.find((one) => one === kind);
  return facet && filter.facets[facet].has(value)
    ? toggleOnlineFacet(filter, facet, value)
    : filter;
}
