import { describe, expect, it } from 'vitest';
import {
  facetValueLabel,
  onlineFilterChips,
  removeOnlineChip,
} from '../../../../../src/library/search/online/onlineFilterChips.ts';
import {
  EMPTY_ONLINE_FILTER,
  toggleOnlineFacet,
  toggleOnlinePreset,
} from '../../../../../src/library/search/online/onlineTrackFilter.ts';
import type { MessageKey } from '../../../../../src/i18n/en.ts';

const t = (key: MessageKey) => `<${key}>`;

describe('在线筛选的条件片', () => {
  it('预设在前、分面在后；音质写档位的显示名，艺人与专辑照写', () => {
    let filter = toggleOnlinePreset(EMPTY_ONLINE_FILTER, 'lossless');
    filter = toggleOnlineFacet(filter, 'artist', 'Nujabes');
    filter = toggleOnlineFacet(filter, 'quality', 'flac24bit');
    filter = toggleOnlineFacet(filter, 'album', 'Modal Soul');
    expect(onlineFilterChips(filter, t)).toEqual([
      { key: 'preset:lossless', label: '<query.lossless>' },
      { key: 'artist:Nujabes', label: 'Nujabes' },
      { key: 'album:Modal Soul', label: 'Modal Soul' },
      { key: 'quality:flac24bit', label: '<online.quality.flac24bit>' },
    ]);
    expect(facetValueLabel('quality', '320k', t)).toBe('<online.quality.320k>');
    expect(facetValueLabel('quality', '未知档', t)).toBe('未知档');
  });

  it('没有条件时一片也没有', () => {
    expect(onlineFilterChips(EMPTY_ONLINE_FILTER, t)).toEqual([]);
  });

  it('按键取消：预设、分面都行；取值里带冒号也认第一个冒号', () => {
    let filter = toggleOnlinePreset(EMPTY_ONLINE_FILTER, 'playable');
    filter = toggleOnlineFacet(filter, 'album', 'Vol. 1: Intro');
    const key = onlineFilterChips(filter, t).find((chip) => chip.label === 'Vol. 1: Intro')?.key;
    expect(key).toBe('album:Vol. 1: Intro');
    const afterAlbum = removeOnlineChip(filter, key ?? '');
    expect(afterAlbum.facets.album.size).toBe(0);
    expect(afterAlbum.presets.has('playable')).toBe(true);
    expect(removeOnlineChip(afterAlbum, 'preset:playable').presets.size).toBe(0);
  });

  it('键对不上任何条件时原样交回，不新建对象', () => {
    const filter = toggleOnlinePreset(EMPTY_ONLINE_FILTER, 'hiRes');
    expect(removeOnlineChip(filter, 'preset:lossless')).toBe(filter);
    expect(removeOnlineChip(filter, 'artist:没勾过')).toBe(filter);
    expect(removeOnlineChip(filter, '乱写的键')).toBe(filter);
  });
});
