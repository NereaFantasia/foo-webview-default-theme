// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PRESETS, presetFor } from '../../../../src/immersive/presets/presets.ts';

describe('presetFor', () => {
  it('选了登记过的预设就用它', () => {
    expect(presetFor('landscape', 'split').id).toBe('split');
    expect(presetFor('portrait', 'split').id).toBe('split');
  });

  it('没选过（空串）或已不在登记表里，回到缺省预设', () => {
    expect(presetFor('landscape', '').id).toBe(PRESETS[0].id);
    expect(presetFor('landscape', '已删掉的预设').id).toBe(PRESETS[0].id);
    expect(presetFor('portrait', '已删掉的预设').id).toBe(PRESETS[0].id);
  });

  it('id 不重复，每个预设声明了最小尺寸', () => {
    expect(new Set(PRESETS.map((entry) => entry.id)).size).toBe(PRESETS.length);
    for (const entry of PRESETS) {
      expect(entry.minSize.width).toBeGreaterThan(0);
      expect(entry.minSize.height).toBeGreaterThan(0);
    }
  });
});
