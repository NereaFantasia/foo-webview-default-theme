// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BLEED_PANEL } from '../../../../src/immersive/presets/bleed/bleedPanel.ts';
import {
  BLEED_SCHEMA,
  bleedOptionsOf,
  layoutOptionsOf,
  lookOf,
} from '../../../../src/immersive/presets/bleed/bleedOptions.ts';
import { DEFAULT_LAYOUT_OPTIONS } from '../../../../src/immersive/presets/bleed/bleedLayout.ts';
import { DEFAULT_BLEED_LOOK } from '../../../../src/immersive/bleed-cover/BleedCover.tsx';
import { PRESETS } from '../../../../src/immersive/presets/presets.ts';

// 预设 2 的可调项：声明、缺省、存档合并与面板声明要对得上

describe('预设 2 的可调项', () => {
  it('没有存档就是全缺省，缺省就是 nereal 定稿的版式与外观', () => {
    const options = bleedOptionsOf(undefined);
    expect(layoutOptionsOf(options)).toEqual(DEFAULT_LAYOUT_OPTIONS);
    expect(lookOf(options)).toEqual(DEFAULT_BLEED_LOOK);
    expect(options.feather).toBe(true);
    expect(options.capsuleOpen).toBe(false);
  });

  it('存档里的值盖过缺省；越界、类型不对的项与不认识的键丢掉，不影响别的项', () => {
    const options = bleedOptionsOf({
      coverWidth: 64,
      blur: 99,
      feather: 'yes',
      unknown: 1,
      capsuleOpen: true,
    });
    expect(options.coverWidth).toBe(64);
    expect(options.blur).toBe(7);
    expect(options.feather).toBe(true);
    expect(options.capsuleOpen).toBe(true);
  });

  it('范围项的缺省在范围里，步长能整除到缺省（滑块停得到缺省）', () => {
    for (const spec of Object.values(BLEED_SCHEMA)) {
      if (spec.kind !== 'range') continue;
      expect(spec.default).toBeGreaterThanOrEqual(spec.min);
      expect(spec.default).toBeLessThanOrEqual(spec.max);
      expect((spec.default - spec.min) % spec.step).toBe(0);
    }
  });

  it('羽化起点与宽度的范围合起来，清晰层终点（起点 + 宽度）最小也不到起点、最大也不超过 100', () => {
    const start = BLEED_SCHEMA.featherStart;
    const width = BLEED_SCHEMA.featherWidth;
    expect(start.min + width.min).toBeGreaterThan(start.min);
    expect(start.max / (start.max + width.min)).toBeLessThan(1);
  });

  it('羽化浓度存百分数，换成系数给元素', () => {
    expect(lookOf(bleedOptionsOf({ featherHold: 180 })).hold).toBeCloseTo(1.8, 6);
  });

  it('面板里的每一项都在声明里，声明里每一项都出现在面板里（不会有改了没有的、有了改不了的）', () => {
    const panelKeys = BLEED_PANEL.flatMap((group) => group.items.map((item) => item.key));
    expect(new Set(panelKeys).size).toBe(panelKeys.length);
    expect([...panelKeys].sort()).toEqual(Object.keys(BLEED_SCHEMA).sort());
  });

  it('登记表里每个预设都给了声明与面板，没有可调项的预设两者都是空的', () => {
    for (const entry of PRESETS) {
      const keys = Object.keys(entry.schema);
      const panelKeys = entry.panel.flatMap((group) => group.items.map((item) => item.key));
      expect([...panelKeys].sort()).toEqual([...keys].sort());
    }
  });
});
