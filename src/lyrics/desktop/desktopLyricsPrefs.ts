import { atom } from 'jotai/vanilla';
import { defineConfigPref } from '../../host/configPref.ts';

export const DESKTOP_LYRICS_ALIGNS = ['left', 'center', 'right'] as const;
export type DesktopLyricsAlign = (typeof DESKTOP_LYRICS_ALIGNS)[number];

export const DESKTOP_LYRICS_MOTION_PRESETS = ['amll', 'winui'] as const;
export type DesktopLyricsMotionPreset = (typeof DESKTOP_LYRICS_MOTION_PRESETS)[number];
export const DESKTOP_LYRICS_MODES = ['multi', 'single'] as const;
export type DesktopLyricsMode = (typeof DESKTOP_LYRICS_MODES)[number];

/** 多行窗口的尺寸，物理像素；切回多行时恢复，位置仍取当前窗口 */
export interface DesktopLyricsSizeMemory {
  readonly width: number;
  readonly height: number;
}

export const DESKTOP_LYRICS_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type DesktopLyricsSize = (typeof DESKTOP_LYRICS_SIZES)[number];

/** 当前行的字号，CSS 像素 */
export const DESKTOP_LYRICS_FONT_SIZES: Readonly<Record<DesktopLyricsSize, number>> = {
  small: 28,
  medium: 34,
  large: 42,
  xlarge: 52,
};

/** `white` 照 AMLL 原样只用一色；另两档已唱、未唱各一色，叠两层播放器 */
export const DESKTOP_LYRICS_PALETTES = ['white', 'follow', 'custom'] as const;
export type DesktopLyricsPalette = (typeof DESKTOP_LYRICS_PALETTES)[number];

export const DESKTOP_LYRICS_BACKGROUNDS = ['transparent', 'plate'] as const;
export type DesktopLyricsBackground = (typeof DESKTOP_LYRICS_BACKGROUNDS)[number];

/** 窗口的位置与尺寸，屏幕坐标，物理像素 */
export interface DesktopLyricsBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const DESKTOP_LYRICS_HOTKEYS = ['toggle', 'lock'] as const;
export type DesktopLyricsHotkey = (typeof DESKTOP_LYRICS_HOTKEYS)[number];

export interface DesktopLyricsPref {
  /** 上次退出时开着，下次启动照样打开 */
  readonly open: boolean;
  readonly locked: boolean;
  readonly align: DesktopLyricsAlign;
  readonly motionPreset: DesktopLyricsMotionPreset;
  readonly mode: DesktopLyricsMode;
  readonly multilineSize: DesktopLyricsSizeMemory | null;
  readonly size: DesktopLyricsSize;
  readonly palette: DesktopLyricsPalette;
  readonly background: DesktopLyricsBackground;
  /** 底板的不透明度，0.1 到 1 */
  readonly plateOpacity: number;
  /** 底板改取封面强调色里明度低的一档 */
  readonly plateTint: boolean;
  /** 自定义的三种颜色，`#rrggbb`；空串是没选过，用缺省色 */
  readonly sungColor: string;
  readonly unsungColor: string;
  readonly glowColor: string;
  readonly showTranslation: boolean;
  readonly showRomanization: boolean;
  /** 主窗口在前台、自己正显示歌词时淡出 */
  readonly autoHide: boolean;
  /** null 是没挪过，按主屏下方居中摆 */
  readonly bounds: DesktopLyricsBounds | null;
  /** 系统热键的组合，写法同宿主 `keyboard.registerHotkey`（如 `Ctrl+Alt+L`）；空串是没设 */
  readonly hotkeys: Readonly<Record<DesktopLyricsHotkey, string>>;
}

export const DEFAULT_DESKTOP_LYRICS: DesktopLyricsPref = {
  open: false,
  locked: false,
  align: 'center',
  motionPreset: 'amll',
  mode: 'multi',
  multilineSize: null,
  size: 'medium',
  palette: 'follow',
  background: 'plate',
  plateOpacity: 0.7,
  plateTint: false,
  sungColor: '',
  unsungColor: '',
  glowColor: '',
  showTranslation: true,
  showRomanization: false,
  autoHide: true,
  bounds: null,
  hotkeys: { toggle: '', lock: '' },
};

const HEX = /^#[0-9a-f]{6}$/i;
/**
 * 修饰键至少一个，末尾一个不是修饰键的键名；单独的功能键也收。键名本身由宿主认，这里只挡明显不成样子的值
 */
const CHORD =
  /^(?:(?:Ctrl|Alt|Shift|Win)\+){1,4}(?!(?:Ctrl|Alt|Shift|Win)$)(?:[A-Za-z0-9]{1,9}|[-=[\];',./\\])$|^F(?:[1-9]|1[0-2])$/;

function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? Reflect.get(raw, key)
    : undefined;
}

function choice<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
  return values.find((value) => value === raw) ?? fallback;
}

function flag(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function color(raw: unknown): string {
  return typeof raw === 'string' && HEX.test(raw) ? raw.toLowerCase() : '';
}

export function isHotkeyChord(raw: unknown): raw is string {
  return typeof raw === 'string' && CHORD.test(raw);
}

/** 换算按键要用到的几项；浏览器的 `KeyboardEvent` 满足它 */
export interface HotkeyInput {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/** `KeyboardEvent.code` 与宿主键名不一样的那些；字母与数字另按前缀换 */
const CODE_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
};

/**
 * 录下的一次按键写成宿主 `keyboard.registerHotkey` 认的组合（`Ctrl+Alt+L`）；按键名取物理键位，
 * 不受 Shift 与输入法影响。只按了修饰键、或没有修饰键的普通键答 null，录键时接着等
 */
export function hotkeyFromKeyboard(input: HotkeyInput): string | null {
  const { code } = input;
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3)
    : /^Digit\d$/.test(code)
      ? code.slice(5)
      : /^F(?:[1-9]|1[0-2])$/.test(code)
        ? code
        : CODE_NAMES[code];
  if (!key) return null;
  const modifiers = [
    input.ctrlKey && 'Ctrl',
    input.altKey && 'Alt',
    input.shiftKey && 'Shift',
    input.metaKey && 'Win',
  ].filter((name) => name !== false);
  const chord = [...modifiers, key].join('+');
  return isHotkeyChord(chord) ? chord : null;
}

function integer(raw: unknown, min: number, max: number): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max
    ? Math.trunc(raw)
    : null;
}

/** 屏幕坐标可以是负的（主屏左边、上边的屏）；尺寸太小或离谱时当没记过 */
export function parseDesktopLyricsBounds(raw: unknown): DesktopLyricsBounds | null {
  const x = integer(field(raw, 'x'), -100_000, 100_000);
  const y = integer(field(raw, 'y'), -100_000, 100_000);
  const width = integer(field(raw, 'width'), 100, 20_000);
  const height = integer(field(raw, 'height'), 50, 20_000);
  return x === null || y === null || width === null || height === null
    ? null
    : { x, y, width, height };
}

export function parseDesktopLyricsSizeMemory(raw: unknown): DesktopLyricsSizeMemory | null {
  const width = integer(field(raw, 'width'), 100, 20_000);
  const height = integer(field(raw, 'height'), 50, 20_000);
  return width === null || height === null ? null : { width, height };
}

/** 逐项校验，缺的或不合法的项回到缺省；config 里的东西谁都能改 */
export function parseDesktopLyricsPref(raw: unknown): DesktopLyricsPref {
  const d = DEFAULT_DESKTOP_LYRICS;
  const opacity = field(raw, 'plateOpacity');
  const hotkeys = field(raw, 'hotkeys');
  const hotkey = (name: DesktopLyricsHotkey) => {
    const value = field(hotkeys, name);
    return isHotkeyChord(value) ? value : '';
  };
  return {
    open: flag(field(raw, 'open'), d.open),
    locked: flag(field(raw, 'locked'), d.locked),
    align: choice(DESKTOP_LYRICS_ALIGNS, field(raw, 'align'), d.align),
    motionPreset: choice(DESKTOP_LYRICS_MOTION_PRESETS, field(raw, 'motionPreset'), d.motionPreset),
    mode: choice(DESKTOP_LYRICS_MODES, field(raw, 'mode'), d.mode),
    multilineSize: parseDesktopLyricsSizeMemory(field(raw, 'multilineSize')),
    size: choice(DESKTOP_LYRICS_SIZES, field(raw, 'size'), d.size),
    palette: choice(DESKTOP_LYRICS_PALETTES, field(raw, 'palette'), d.palette),
    background: choice(DESKTOP_LYRICS_BACKGROUNDS, field(raw, 'background'), d.background),
    plateOpacity:
      typeof opacity === 'number' && Number.isFinite(opacity)
        ? Math.round(Math.min(1, Math.max(0.1, opacity)) * 100) / 100
        : d.plateOpacity,
    plateTint: flag(field(raw, 'plateTint'), d.plateTint),
    sungColor: color(field(raw, 'sungColor')),
    unsungColor: color(field(raw, 'unsungColor')),
    glowColor: color(field(raw, 'glowColor')),
    showTranslation: flag(field(raw, 'showTranslation'), d.showTranslation),
    showRomanization: flag(field(raw, 'showRomanization'), d.showRomanization),
    autoHide: flag(field(raw, 'autoHide'), d.autoHide),
    bounds: parseDesktopLyricsBounds(field(raw, 'bounds')),
    hotkeys: { toggle: hotkey('toggle'), lock: hotkey('lock') },
  };
}

function toConfig(pref: DesktopLyricsPref) {
  return {
    ...pref,
    bounds: pref.bounds && { ...pref.bounds },
    multilineSize: pref.multilineSize && { ...pref.multilineSize },
    hotkeys: { ...pref.hotkeys },
  };
}

export const DESKTOP_LYRICS_PREF = defineConfigPref(
  'defaultTheme.desktopLyrics',
  toConfig(DEFAULT_DESKTOP_LYRICS),
  (raw) =>
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? toConfig(parseDesktopLyricsPref(raw))
      : undefined,
);

export const desktopLyricsPrefAtom = atom((get) =>
  parseDesktopLyricsPref(get(DESKTOP_LYRICS_PREF.atom)),
);

/** 托盘与入口要的两项：开着没有、锁着没有 */
export const desktopLyricsSwitchesAtom = atom((get) => {
  const { open, locked } = get(desktopLyricsPrefAtom);
  return { open, locked };
});

export { toConfig as desktopLyricsConfig };
