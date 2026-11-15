import { atom } from 'jotai/vanilla';
import { defineConfigPref } from '../../host/configPref.ts';
import { fontWeightOf } from '../../kit/variableFont.ts';
import { LYRICS_MOTION_PRESET_VALUES } from '../lyricsMotion.ts';
import { fontNameOf } from '../../theme/fontStack.ts';

export const DESKTOP_LYRICS_ALIGNS = ['left', 'center', 'right'] as const;
export type DesktopLyricsAlign = (typeof DESKTOP_LYRICS_ALIGNS)[number];

export const DESKTOP_LYRICS_MOTION_PRESETS = ['amll', 'winui', 'custom'] as const;
export type DesktopLyricsMotionPreset = (typeof DESKTOP_LYRICS_MOTION_PRESETS)[number];
export const DESKTOP_LYRICS_MODES = ['multi', 'single'] as const;
export type DesktopLyricsMode = (typeof DESKTOP_LYRICS_MODES)[number];

/** 多行窗口的尺寸，物理像素；切回多行时恢复，位置仍取当前窗口 */
export interface DesktopLyricsSizeMemory {
  readonly width: number;
  readonly height: number;
}

export const DESKTOP_LYRICS_SIZES = ['small', 'medium', 'large', 'xlarge', 'custom'] as const;
export type DesktopLyricsSize = (typeof DESKTOP_LYRICS_SIZES)[number];

/** 自定义字号与自定义译文字号的取值范围，CSS 像素 */
export const DESKTOP_LYRICS_SIZE_RANGE = { min: 12, max: 96 } as const;
export const DESKTOP_LYRICS_TRANSLATION_RANGE = { min: 10, max: 96 } as const;

/** 前四档的当前行字号，CSS 像素；`custom` 取偏好里的 `customSize` */
export const DESKTOP_LYRICS_FONT_SIZES: Readonly<
  Record<Exclude<DesktopLyricsSize, 'custom'>, number>
> = {
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

/** 自定义动效的四项，只对多行窗口生效；单行的动效不读它们（见 `desktopMotion`） */
export interface DesktopMotionCustom {
  readonly blur: boolean;
  readonly scale: boolean;
  readonly hidePassedLines: boolean;
  /** 当前行对齐到窗口的位置，从上往下的比例，0 到 1 */
  readonly alignPosition: number;
}

export interface DesktopLyricsPref {
  /** 上次退出时开着，下次启动照样打开 */
  readonly open: boolean;
  readonly locked: boolean;
  readonly align: DesktopLyricsAlign;
  readonly motionPreset: DesktopLyricsMotionPreset;
  /** 动效选「自定义」时的四项；null 是还没自定义过，第一次切到自定义时以当时的预设为起点 */
  readonly motionCustom: DesktopMotionCustom | null;
  readonly mode: DesktopLyricsMode;
  readonly multilineSize: DesktopLyricsSizeMemory | null;
  readonly size: DesktopLyricsSize;
  /** `size` 为 `custom` 时的当前行字号，CSS 像素 */
  readonly customSize: number;
  /** 译文字号，CSS 像素；null 是随正文缩放（正文的 0.6 倍） */
  readonly translationSize: number | null;
  /** 桌面歌词的字体；空串沿用界面字体 */
  readonly fontFamily: string;
  /** 字重，只对可变字体有意义；null 沿用继承的字重 */
  readonly fontWeight: number | null;
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
  motionCustom: null,
  mode: 'multi',
  multilineSize: null,
  size: 'medium',
  customSize: 40,
  translationSize: null,
  fontFamily: '',
  fontWeight: null,
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

/** 自定义动效缺项时的底：AMLL 档的这四项，当前行位置照桌面固定的居中 */
const AMLL_CUSTOM: DesktopMotionCustom = {
  blur: LYRICS_MOTION_PRESET_VALUES.amll.blur,
  scale: LYRICS_MOTION_PRESET_VALUES.amll.scale,
  hidePassedLines: LYRICS_MOTION_PRESET_VALUES.amll.hidePassedLines,
  alignPosition: 0.5,
};

const HEX = /^#[0-9a-f]{6}$/i;
/**
 * 至少一个修饰键，末尾是一个非修饰键的键名。键名本身由宿主校验，这里只拦截明显不合格式的值
 */
const CHORD =
  /^((?:(?:Ctrl|Alt|Shift|Win)\+){1,4})((?!(?:Ctrl|Alt|Shift|Win)$)(?:[A-Za-z0-9]{1,9}|[-=[\];',./\\]))$/;

/** 宿主的系统热键拒收的组合：文本编辑与窗口切换的常用键。修饰键按 Ctrl、Alt、Shift、Win 的次序书写，键名大写 */
const REFUSED_CHORDS: ReadonlySet<string> = new Set([
  'CTRL+A',
  'CTRL+C',
  'CTRL+V',
  'CTRL+X',
  'CTRL+Y',
  'CTRL+Z',
  'CTRL+SHIFT+Z',
  'ALT+F4',
  'ALT+TAB',
  'ALT+SPACE',
]);

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

/** 宿主接受的系统热键：要带 Ctrl、Alt 或 Win（只有 Shift 不行，单独的功能键也不行），且不在拒收的组合里 */
export function isHotkeyChord(raw: unknown): raw is string {
  const match = typeof raw === 'string' ? CHORD.exec(raw) : null;
  if (!match) return false;
  const [, prefix = '', key = ''] = match;
  const held = new Set(prefix.toUpperCase().split('+').filter(Boolean));
  if (!held.has('CTRL') && !held.has('ALT') && !held.has('WIN')) return false;
  const ordered = ['CTRL', 'ALT', 'SHIFT', 'WIN'].filter((name) => held.has(name));
  return !REFUSED_CHORDS.has([...ordered, key.toUpperCase()].join('+'));
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

/** 逐项校验；缺项或不合法的项取 AMLL 档的值 */
export function parseMotionCustom(raw: unknown, base: DesktopMotionCustom): DesktopMotionCustom {
  const position = field(raw, 'alignPosition');
  return {
    blur: flag(field(raw, 'blur'), base.blur),
    scale: flag(field(raw, 'scale'), base.scale),
    hidePassedLines: flag(field(raw, 'hidePassedLines'), base.hidePassedLines),
    alignPosition:
      typeof position === 'number' && Number.isFinite(position)
        ? Math.round(Math.min(1, Math.max(0, position)) * 100) / 100
        : base.alignPosition,
  };
}

/** 当前行的字号，CSS 像素 */
export function desktopFontSizeOf(pref: Pick<DesktopLyricsPref, 'size' | 'customSize'>): number {
  return pref.size === 'custom' ? pref.customSize : DESKTOP_LYRICS_FONT_SIZES[pref.size];
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
    motionCustom:
      field(raw, 'motionCustom') === undefined || field(raw, 'motionCustom') === null
        ? null
        : parseMotionCustom(field(raw, 'motionCustom'), AMLL_CUSTOM),
    mode: choice(DESKTOP_LYRICS_MODES, field(raw, 'mode'), d.mode),
    multilineSize: parseDesktopLyricsSizeMemory(field(raw, 'multilineSize')),
    size: choice(DESKTOP_LYRICS_SIZES, field(raw, 'size'), d.size),
    customSize:
      integer(
        field(raw, 'customSize'),
        DESKTOP_LYRICS_SIZE_RANGE.min,
        DESKTOP_LYRICS_SIZE_RANGE.max,
      ) ?? d.customSize,
    translationSize: integer(
      field(raw, 'translationSize'),
      DESKTOP_LYRICS_TRANSLATION_RANGE.min,
      DESKTOP_LYRICS_TRANSLATION_RANGE.max,
    ),
    fontFamily: fontNameOf(field(raw, 'fontFamily')),
    fontWeight: fontWeightOf(field(raw, 'fontWeight')),
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
    motionCustom: pref.motionCustom && { ...pref.motionCustom },
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
