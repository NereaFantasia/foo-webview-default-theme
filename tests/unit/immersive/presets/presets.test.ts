// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PRESETS, fitsOrientation, presetFor } from '../../../../src/immersive/presets/presets.ts';

describe('presetFor', () => {
  it('选了登记过的预设就用它', () => {
    expect(presetFor('landscape', 'split').id).toBe('split');
    expect(presetFor('portrait', 'split').id).toBe('split');
    expect(presetFor('landscape', 'bleed').id).toBe('bleed');
  });

  it('没选过（空串）或已不在登记表里，回到缺省预设', () => {
    expect(presetFor('landscape', '').id).toBe(PRESETS[0].id);
    expect(presetFor('landscape', '已删掉的预设').id).toBe(PRESETS[0].id);
    expect(presetFor('portrait', '已删掉的预设').id).toBe(PRESETS[0].id);
  });

  it('id 不重复，每个预设声明了最小尺寸与名字、缩略图', () => {
    expect(new Set(PRESETS.map((entry) => entry.id)).size).toBe(PRESETS.length);
    for (const entry of PRESETS) {
      expect(entry.minSize.width).toBeGreaterThan(0);
      expect(entry.minSize.height).toBeGreaterThan(0);
      expect(entry.name).toMatch(/^immersive\.preset\./);
      expect(typeof entry.Preview).toBe('function');
    }
  });

  it('只做横版的预设在竖版里退回缺省预设，存档里选的不被改', () => {
    expect(presetFor('portrait', 'bleed').id).toBe('split');
    expect(
      fitsOrientation(
        PRESETS.find((entry) => entry.id === 'bleed')!,
        'portrait',
      ),
    ).toBe(false);
    expect(fitsOrientation(PRESETS[0], 'portrait')).toBe(true);
  });

  it('窗口小于预设声明的最小尺寸，退回缺省预设；够大了立刻回来', () => {
    expect(presetFor('landscape', 'bleed', { width: 1280, height: 800 }).id).toBe('bleed');
    expect(presetFor('landscape', 'bleed', { width: 960, height: 600 }).id).toBe('bleed');
    expect(presetFor('landscape', 'bleed', { width: 959, height: 800 }).id).toBe('split');
    expect(presetFor('landscape', 'bleed', { width: 1600, height: 599 }).id).toBe('split');
  });

  it('缺省预设自己按比例缩小，再小的窗口也不会被排除', () => {
    expect(presetFor('landscape', 'split', { width: 300, height: 200 }).id).toBe('split');
    expect(presetFor('landscape', 'bleed', { width: 300, height: 200 }).id).toBe('split');
  });
});
