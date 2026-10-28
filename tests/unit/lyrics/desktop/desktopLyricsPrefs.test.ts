import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP_LYRICS,
  hotkeyFromKeyboard,
  isHotkeyChord,
  parseDesktopLyricsBounds,
  parseDesktopLyricsPref,
} from '../../../../src/lyrics/desktop/desktopLyricsPrefs.ts';

describe('parseDesktopLyricsPref', () => {
  it('旧偏好缺少模式和预设时沿用多行与 AMLL，新偏好保留独立选择', () => {
    expect(parseDesktopLyricsPref({ open: true })).toMatchObject({
      motionPreset: 'amll',
      mode: 'multi',
      multilineSize: null,
    });
    expect(
      parseDesktopLyricsPref({
        motionPreset: 'winui',
        mode: 'single',
        multilineSize: { width: 800, height: 500 },
      }),
    ).toMatchObject({
      motionPreset: 'winui',
      mode: 'single',
      multilineSize: { width: 800, height: 500 },
    });
    expect(parseDesktopLyricsPref({ motionPreset: 'custom', mode: 'invalid' })).toMatchObject({
      motionPreset: 'amll',
      mode: 'multi',
    });
  });
  it('不是对象时整份回到缺省', () => {
    expect(parseDesktopLyricsPref(null)).toEqual(DEFAULT_DESKTOP_LYRICS);
    expect(parseDesktopLyricsPref([1, 2])).toEqual(DEFAULT_DESKTOP_LYRICS);
  });

  it('逐项校验：不认识的取值回到缺省，其余照收', () => {
    const pref = parseDesktopLyricsPref({
      open: true,
      align: 'justify',
      size: 'large',
      palette: 'custom',
      background: 'glass',
      sungColor: '#ABCDEF',
      unsungColor: 'red',
      glowColor: '#12345',
      showRomanization: 'yes',
    });
    expect(pref).toMatchObject({
      open: true,
      align: 'center',
      size: 'large',
      palette: 'custom',
      background: 'plate',
      sungColor: '#abcdef',
      unsungColor: '',
      glowColor: '',
      showRomanization: false,
    });
  });

  it('底板浓度夹到 0.1 到 1 之间，保留两位小数', () => {
    expect(parseDesktopLyricsPref({ plateOpacity: 0 }).plateOpacity).toBe(0.1);
    expect(parseDesktopLyricsPref({ plateOpacity: 3 }).plateOpacity).toBe(1);
    expect(parseDesktopLyricsPref({ plateOpacity: 0.456 }).plateOpacity).toBe(0.46);
    expect(parseDesktopLyricsPref({ plateOpacity: Number.NaN }).plateOpacity).toBe(0.7);
  });

  it('热键只收带修饰键的组合与单独的功能键', () => {
    const pref = parseDesktopLyricsPref({ hotkeys: { toggle: 'Ctrl+Alt+L', lock: 'L' } });
    expect(pref.hotkeys).toEqual({ toggle: 'Ctrl+Alt+L', lock: '' });
    expect(isHotkeyChord('F9')).toBe(true);
    expect(isHotkeyChord('Ctrl+Shift')).toBe(false);
    expect(isHotkeyChord('Ctrl+Alt+Delete+X')).toBe(false);
  });
});

describe('parseDesktopLyricsBounds', () => {
  it('收负坐标（主屏左边、上边的屏），取整', () => {
    expect(parseDesktopLyricsBounds({ x: -1920.6, y: -40, width: 640.2, height: 472 })).toEqual({
      x: -1920,
      y: -40,
      width: 640,
      height: 472,
    });
  });

  it('缺项或尺寸离谱时当没记过', () => {
    expect(parseDesktopLyricsBounds({ x: 0, y: 0, width: 640 })).toBeNull();
    expect(parseDesktopLyricsBounds({ x: 0, y: 0, width: 10, height: 472 })).toBeNull();
  });
});

describe('hotkeyFromKeyboard', () => {
  const press = (code: string, mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>>) =>
    hotkeyFromKeyboard({
      code,
      ctrlKey: mods.ctrl ?? false,
      altKey: mods.alt ?? false,
      shiftKey: mods.shift ?? false,
      metaKey: mods.meta ?? false,
    });

  it('按物理键位写成宿主认的组合，修饰键在前', () => {
    expect(press('KeyL', { ctrl: true, alt: true })).toBe('Ctrl+Alt+L');
    expect(press('Digit3', { shift: true, meta: true })).toBe('Shift+Win+3');
    expect(press('ArrowUp', { ctrl: true })).toBe('Ctrl+Up');
    expect(press('Backslash', { alt: true })).toBe('Alt+\\');
    expect(press('F9', {})).toBe('F9');
  });

  it('只按了修饰键、没有修饰键的普通键、认不出的键都不算', () => {
    expect(press('ControlLeft', { ctrl: true })).toBeNull();
    expect(press('KeyL', {})).toBeNull();
    expect(press('NumpadAdd', { ctrl: true })).toBeNull();
  });
});
