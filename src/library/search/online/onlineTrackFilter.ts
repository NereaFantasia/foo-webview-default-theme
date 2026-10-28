import type { MessageKey } from '../../../i18n/en.ts';
import type { MusicTrack } from '../../../server/musicObjects.ts';
import type { SearchScope } from '../searchQuery.ts';
import { bestQuality } from './OnlineItems.tsx';

/** 在线检索字段范围；平台不支持服务端按字段检索，前端在客户端对返回曲目做字段匹配 */
export type OnlineScope = Extract<SearchScope, 'any' | 'title' | 'artist' | 'album'>;
export const ONLINE_SCOPES: readonly OnlineScope[] = ['any', 'title', 'artist', 'album'];

export const ONLINE_PRESETS = ['playable', 'lossless', 'hiRes'] as const;
export type OnlinePreset = (typeof ONLINE_PRESETS)[number];
export const ONLINE_PRESET_LABELS: Readonly<Record<OnlinePreset, MessageKey>> = {
  playable: 'online.playable',
  lossless: 'query.lossless',
  hiRes: 'query.hiRes',
};

export const ONLINE_FACETS = ['artist', 'album', 'quality'] as const;
export type OnlineFacet = (typeof ONLINE_FACETS)[number];

export interface OnlineTrackFilter {
  readonly presets: ReadonlySet<OnlinePreset>;
  readonly facets: Readonly<Record<OnlineFacet, ReadonlySet<string>>>;
}

export const EMPTY_ONLINE_FILTER: OnlineTrackFilter = {
  presets: new Set(),
  facets: { artist: new Set(), album: new Set(), quality: new Set() },
};

export interface OnlineFacetValue {
  readonly value: string;
  readonly count: number;
}

/** 提取曲目在指定分面上的特征值列表：艺人拆分署名，专辑取标题，音质取最高可用档位 */
function facetValues(track: MusicTrack, facet: OnlineFacet): readonly string[] {
  if (facet === 'artist') return track.artists.map((artist) => artist.name).filter(Boolean);
  if (facet === 'album') return track.album?.title ? [track.album.title] : [];
  const quality = bestQuality(track);
  return quality ? [quality] : [];
}

/** 统计曲目列表中各分面取值的频次；优先按曲目数降序排序，相同频次按名称升序排序 */
export function onlineFacetOptions(
  tracks: readonly MusicTrack[],
): Readonly<Record<OnlineFacet, readonly OnlineFacetValue[]>> {
  const count = (facet: OnlineFacet) => {
    const counts = new Map<string, number>();
    for (const track of tracks)
      for (const value of new Set(facetValues(track, facet)))
        counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts]
      .map(([value, total]) => ({ value, count: total }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return { artist: count('artist'), album: count('album'), quality: count('quality') };
}

export function onlineConditionCount(filter: OnlineTrackFilter): number {
  return (
    filter.presets.size +
    ONLINE_FACETS.reduce((total, facet) => total + filter.facets[facet].size, 0)
  );
}

/** 校验曲目在限定字段内是否包含全部检索分词；「任意」范围直接放行平台的匹配结果 */
function matchesScope(track: MusicTrack, words: readonly string[], scope: OnlineScope): boolean {
  if (scope === 'any' || words.length === 0) return true;
  const field =
    scope === 'title'
      ? `${track.title} ${track.subtitle ?? ''}`
      : scope === 'artist'
        ? track.artists.map((artist) => artist.name).join(' ')
        : (track.album?.title ?? '');
  const lower = field.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/**
 * 按字段范围、预设条件及分面过滤曲目列表，保持原有顺序
 * 预设条件含可播放性与最高音质档位；同一分面内为析取（满足其一），多项分面之间为合取（全部满足）
 */
export function filterOnlineTracks(
  tracks: readonly MusicTrack[],
  text: string,
  scope: OnlineScope,
  filter: OnlineTrackFilter,
  playable: (track: MusicTrack) => boolean,
): readonly MusicTrack[] {
  if (scope === 'any' && onlineConditionCount(filter) === 0) return tracks;
  const words = text.toLowerCase().split(/\s+/u).filter(Boolean);
  const lossless = (track: MusicTrack) => {
    const best = bestQuality(track);
    return best === 'flac' || best === 'flac24bit';
  };
  return tracks.filter(
    (track) =>
      matchesScope(track, words, scope) &&
      (!filter.presets.has('playable') || playable(track)) &&
      (!filter.presets.has('lossless') || lossless(track)) &&
      (!filter.presets.has('hiRes') || bestQuality(track) === 'flac24bit') &&
      ONLINE_FACETS.every((facet) => {
        const chosen = filter.facets[facet];
        return chosen.size === 0 || facetValues(track, facet).some((value) => chosen.has(value));
      }),
  );
}

export function toggleOnlinePreset(
  filter: OnlineTrackFilter,
  preset: OnlinePreset,
): OnlineTrackFilter {
  const presets = new Set(filter.presets);
  if (!presets.delete(preset)) presets.add(preset);
  return { ...filter, presets };
}

export function toggleOnlineFacet(
  filter: OnlineTrackFilter,
  facet: OnlineFacet,
  value: string,
): OnlineTrackFilter {
  const chosen = new Set(filter.facets[facet]);
  if (!chosen.delete(value)) chosen.add(value);
  return { ...filter, facets: { ...filter.facets, [facet]: chosen } };
}
