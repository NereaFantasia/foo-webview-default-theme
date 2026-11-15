import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP_LYRICS,
  desktopFontSizeOf,
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
    expect(parseDesktopLyricsPref({ motionPreset: 'springy', mode: 'invalid' })).toMatchObject({
      motionPreset: 'amll',
      mode: 'multi',
    });
  });
  it('字体名与字重逐项校验：不合格的回到缺省', () => {
    expect(parseDesktopLyricsPref({ fontFamily: ' Georgia ', fontWeight: 450 })).toMatchObject({
      fontFamily: 'Georgia',
      fontWeight: 450,
    });
    expect(parseDesktopLyricsPref({ fontFamily: 'a\nb', fontWeight: 1000 })).toMatchObject({
      fontFamily: '',
      fontWeight: null,
    });
    expect(parseDesktopLyricsPref({})).toMatchObject({ fontFamily: '', fontWeight: null });
  });

  it('自定义字号与译文字号逐项校验；自定义动效没存过是 null，存了逐项校验', () => {
    expect(
      parseDesktopLyricsPref({ size: 'custom', customSize: 46, translationSize: 24 }),
    ).toMatchObject({
      size: 'custom',
      customSize: 46,
      translationSize: 24,
      motionCustom: null,
    });
    expect(parseDesktopLyricsPref({ customSize: 5, translationSize: 200 })).toMatchObject({
      customSize: 40,
      translationSize: null,
    });
    expect(
      parseDesktopLyricsPref({
        motionPreset: 'custom',
        motionCustom: { blur: false, hidePassedLines: 'yes', alignPosition: 0.456 },
      }),
    ).toMatchObject({
      motionPreset: 'custom',
      motionCustom: { blur: false, scale: true, hidePassedLines: false, alignPosition: 0.46 },
    });
  });

  it('当前行字号：前四档取定值，自定义取 customSize', () => {
    expect(desktopFontSizeOf({ size: 'medium', customSize: 99 })).toBe(34);
    expect(desktopFontSizeOf({ size: 'xlarge', customSize: 99 })).toBe(52);
    expect(desktopFontSizeOf({ size: 'custom', customSize: 46 })).toBe(46);
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

  it('热键只接受带 Ctrl、Alt 或 Win 的组合，单独的功能键、只有 Shift 的、宿主拒收的组合都不接受', () => {
    const pref = parseDesktopLyricsPref({
      hotkeys: { toggle: 'Ctrl+Alt+L', lock: 'F9' },
    });
    expect(pref.hotkeys).toEqual({ toggle: 'Ctrl+Alt+L', lock: '' });
    expect(isHotkeyChord('Ctrl+F9')).toBe(true);
    expect(isHotkeyChord('Win+Shift+L')).toBe(true);
    expect(isHotkeyChord('L')).toBe(false);
    expect(isHotkeyChord('F9')).toBe(false);
    expect(isHotkeyChord('Shift+L')).toBe(false);
    expect(isHotkeyChord('Ctrl+Shift')).toBe(false);
    expect(isHotkeyChord('Ctrl+Alt+Delete+X')).toBe(false);
    for (const refused of ['Ctrl+C', 'Ctrl+Y', 'Shift+Ctrl+Z', 'Alt+F4', 'Alt+Tab', 'Alt+Space'])
      expect(isHotkeyChord(refused), refused).toBe(false);
    expect(isHotkeyChord('Ctrl+Alt+C')).toBe(true);
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
    expect(press('F9', { ctrl: true })).toBe('Ctrl+F9');
  });

  it('只有修饰键、没有修饰键的键、宿主拒收的组合、无法识别的键名都不是有效热键', () => {
    expect(press('ControlLeft', { ctrl: true })).toBeNull();
    expect(press('KeyL', {})).toBeNull();
    expect(press('F9', {})).toBeNull();
    expect(press('KeyL', { shift: true })).toBeNull();
    expect(press('KeyC', { ctrl: true })).toBeNull();
    expect(press('Space', { alt: true })).toBeNull();
    expect(press('NumpadAdd', { ctrl: true })).toBeNull();
  });
});
