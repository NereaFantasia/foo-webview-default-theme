import { describe, expect, it } from 'vitest';
import {
  fillQuery,
  isPresetId,
  needsConnector,
  presetOf,
  QUERY_PRESETS,
  QUERY_SNIPPETS,
  togglePreset,
  type PresetId,
  type QuerySnippet,
} from '../../../src/track/queryPresets.ts';

const snippet = (id: QuerySnippet['id']): QuerySnippet => {
  const found = QUERY_SNIPPETS.find((one) => one.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('预设', () => {
  it('每条预设的 id 唯一，查到的就是清单里那一条', () => {
    expect(new Set(QUERY_PRESETS.map((preset) => preset.id)).size).toBe(QUERY_PRESETS.length);
    expect(presetOf('lossless').query).toBe('%__encoding% IS lossless');
    expect(isPresetId('frequent')).toBe(true);
    expect(isPresetId('popular')).toBe(false);
  });

  it('勾上一条时取消与它冲突的那条；再点一次取消；结果按清单的次序', () => {
    const start = new Set<PresetId>(['lossless', 'unrated', 'neverPlayed']);
    expect([...togglePreset(start, 'highRated')]).toEqual(['highRated', 'neverPlayed', 'lossless']);
    expect([...togglePreset(start, 'recentlyPlayed')]).toEqual([
      'unrated',
      'recentlyPlayed',
      'lossless',
    ]);
    expect([...togglePreset(start, 'lossless')]).toEqual(['unrated', 'neverPlayed']);
  });
});

describe('把写法填进过滤框', () => {
  it('高级草稿为空时直接填入查询，选中待编辑参数', () => {
    const filled = fillQuery('', snippet('format'));
    expect(filled.text).toBe('%codec% IS flac');
    expect(filled.text.slice(filled.start, filled.end)).toBe('flac');
    expect(fillQuery('  ', snippet('decade')).text).toBe('"$left(%date%,3)" IS 199');
  });

  it('已有查询时用 AND 接在后面；连接词本身不再加 AND', () => {
    expect(fillQuery('%rating% MISSING', snippet('not')).text).toBe('%rating% MISSING AND NOT ');
    const or = fillQuery('%rating% MISSING', snippet('or'), needsConnector('or'));
    expect(or.text).toBe('%rating% MISSING OR ');
    expect(or.start).toBe(or.text.length);
    expect(needsConnector('decade')).toBe(true);
  });

  it('保留高级草稿中的问号与百分号，不再剥离模式前缀', () => {
    expect(fillQuery('title HAS "?"', { text: '%rating% GREATER 3' }).text).toBe(
      'title HAS "?" AND %rating% GREATER 3',
    );
  });
});
