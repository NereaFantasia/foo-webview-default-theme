import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_TILES,
  selectedTile,
  tileAction,
} from '../../../src/settings/windowBackgroundChoice.ts';

describe('selectedTile', () => {
  it('来源不是材质时，选中的就是来源那一张', () => {
    for (const source of ['cover', 'palette', 'image'] as const) {
      expect(selectedTile(source, 'mica', false)).toBe(source);
      expect(selectedTile(source, 'none', true)).toBe(source);
    }
  });

  it('来源是材质：材质选 none 是主题色，选别的是系统材质', () => {
    expect(selectedTile('material', 'none', false)).toBe('theme');
    for (const choice of ['inherit', 'mica', 'mica-alt', 'acrylic'] as const)
      expect(selectedTile('material', choice, false)).toBe('material');
  });

  it('宿主回退到主题色时，存着什么材质都显示主题色', () => {
    for (const choice of ['inherit', 'mica', 'mica-alt', 'acrylic', 'none'] as const)
      expect(selectedTile('material', choice, true)).toBe('theme');
  });
});

describe('tileAction', () => {
  it('主题色：来源回材质，材质写 none', () => {
    expect(tileAction('theme', 'mica')).toStrictEqual({ source: 'material', choice: 'none' });
  });

  it('系统材质：材质已是别的就不动，是 none 就回到跟随首选项', () => {
    expect(tileAction('material', 'acrylic')).toStrictEqual({ source: 'material' });
    expect(tileAction('material', 'none')).toStrictEqual({ source: 'material', choice: 'inherit' });
  });

  it('封面、色场、图片只换来源，不碰材质', () => {
    for (const tile of ['cover', 'palette', 'image'] as const) {
      const action = tileAction(tile, 'mica-alt');
      expect(action).toStrictEqual({ source: tile });
      expect('choice' in action).toBe(false);
    }
  });

  it('点哪一张，随后选中的就是哪一张', () => {
    for (const from of ['inherit', 'mica', 'none'] as const) {
      for (const tile of BACKGROUND_TILES) {
        const action = tileAction(tile, from);
        expect(selectedTile(action.source, action.choice ?? from, false)).toBe(tile);
      }
    }
  });
});
