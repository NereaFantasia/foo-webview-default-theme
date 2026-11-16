import type {
  LyricDataConfig,
  LyricLine,
  MaskObsceneWordsMode,
} from '@applemusic-like-lyrics/core';
import { atom } from 'jotai/vanilla';
import { defineConfigPref, startConfigPrefs, type ConfigPrefFace } from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { fontStyleOf, fontWeightOf } from '../kit/variableFont.ts';
import { fontNameOf } from '../theme/fontStack.ts';
import { LYRICS_ALIGN_ANCHORS, type LyricsAlignAnchor } from './lyricsMotion.ts';
import type { LyricsView } from './lyricsSettings.ts';

export const LYRICS_OPTIMIZATIONS = [
  'normalizeSpaces',
  'resetLineTimestamps',
  'syncMainAndBackgroundLines',
  'cleanUnintentionalOverlaps',
  'tryAdvanceStartTime',
] as const;
export const LYRICS_MASK_MODES = ['', 'full-mask', 'partial-mask'] as const;
export const LYRICS_ALIGNS = ['left', 'center', 'right'] as const;
export type LyricsAlign = (typeof LYRICS_ALIGNS)[number];

export interface LyricsTypography {
  /** 字体名称，空串表示沿用界面字体 */
  readonly fontFamily: string;
  /** 字重，只对可变字体生效。null 表示沿用继承的字重 */
  readonly fontWeight: number | null;
  /** 译文字号（CSS 像素），null 表示沿用播放器的副行比例 */
  readonly translationFontSize: number | null;
  readonly showTranslation: boolean;
  readonly showRomanization: boolean;
}

export const DEFAULT_LYRICS_TYPOGRAPHY: LyricsTypography = {
  fontFamily: '',
  fontWeight: null,
  translationFontSize: null,
  showTranslation: true,
  showRomanization: true,
};

export interface LyricsDisplay extends LyricsTypography {
  readonly fontSize: number;
  /** 歌词的水平对齐，通过每行的对唱标记实现，见 `alignLyricLines` */
  readonly align: LyricsAlign;
  readonly autoSeek: boolean;
  readonly overscan: number;
  readonly backgroundLast: boolean;
  readonly maskMode: MaskObsceneWordsMode;
  readonly maskChar: string;
  readonly optimize: Readonly<Record<(typeof LYRICS_OPTIMIZATIONS)[number], boolean>>;
}

/** 歌词字号的取值范围（CSS 像素） */
export const LYRICS_FONT_SIZE_RANGE = { min: 12, max: 48 } as const;
/** 沉浸视图的缩放比例（百分比），100% 对应 22 像素的存档字号 */
export const LYRICS_SCALE_RANGE = { min: 50, max: 225, step: 5 } as const;

export function lyricsScalePercent(fontSize: number): number {
  return Math.round((fontSize / DEFAULT_LYRICS_DISPLAY.fontSize) * 100);
}

export function lyricsScaleFontSize(percent: number): number {
  return (DEFAULT_LYRICS_DISPLAY.fontSize * percent) / 100;
}

export interface LyricsViewAppearance extends LyricsTypography {
  readonly fontSource: 'interface' | 'main' | 'custom';
  /** 存档字号。沉浸视图以 22 为缩放基准，实际字号由版式计算 */
  readonly fontSize: number;
  readonly align: LyricsAlign;
  readonly backgroundLast: boolean;
  readonly positionMode: 'layout' | 'custom';
  readonly alignAnchor: LyricsAlignAnchor;
  readonly alignPosition: number;
}

export const DEFAULT_LYRICS_DISPLAY: LyricsDisplay = {
  ...DEFAULT_LYRICS_TYPOGRAPHY,
  fontSize: 22,
  align: 'left',
  autoSeek: true,
  overscan: 300,
  backgroundLast: false,
  maskMode: '',
  maskChar: '*',
  optimize: {
    normalizeSpaces: true,
    resetLineTimestamps: true,
    syncMainAndBackgroundLines: true,
    cleanUnintentionalOverlaps: true,
    tryAdvanceStartTime: true,
  },
};

function field(raw: unknown, key: string): unknown {
  return raw && typeof raw === 'object' ? Reflect.get(raw, key) : undefined;
}

function number(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.min(max, Math.max(min, raw))
    : fallback;
}

function boolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

export function parseLyricsDisplay(raw: unknown): LyricsDisplay {
  const d = DEFAULT_LYRICS_DISPLAY;
  const optimize = { ...d.optimize };
  for (const key of LYRICS_OPTIMIZATIONS)
    optimize[key] = boolean(field(field(raw, 'optimize'), key), d.optimize[key]);
  const maskChar = field(raw, 'maskChar');
  return {
    ...parseTypography(raw),
    fontSize: number(
      field(raw, 'fontSize'),
      d.fontSize,
      LYRICS_FONT_SIZE_RANGE.min,
      LYRICS_FONT_SIZE_RANGE.max,
    ),
    align: LYRICS_ALIGNS.find((value) => value === field(raw, 'align')) ?? d.align,
    autoSeek: boolean(field(raw, 'autoSeek'), d.autoSeek),
    overscan: number(field(raw, 'overscan'), d.overscan, 0, 2000),
    backgroundLast: boolean(field(raw, 'backgroundLast'), d.backgroundLast),
    maskMode: LYRICS_MASK_MODES.find((value) => value === field(raw, 'maskMode')) ?? d.maskMode,
    maskChar:
      typeof maskChar === 'string' && [...maskChar].length === 1 && maskChar.trim()
        ? maskChar
        : d.maskChar,
    optimize,
  };
}

function parseTypography(raw: unknown): LyricsTypography {
  const size = field(raw, 'translationFontSize');
  return {
    fontFamily: fontNameOf(field(raw, 'fontFamily')),
    fontWeight: fontWeightOf(field(raw, 'fontWeight')),
    translationFontSize:
      typeof size === 'number' && Number.isFinite(size) ? number(size, 16, 10, 48) : null,
    showTranslation: boolean(field(raw, 'showTranslation'), true),
    showRomanization: boolean(field(raw, 'showRomanization'), true),
  };
}

/** 各视图共用的歌词整理与渲染参数 */
function baseDisplay(value: LyricsDisplay) {
  const { autoSeek, overscan, maskMode, maskChar, optimize } = value;
  return {
    autoSeek,
    overscan,
    maskMode,
    maskChar,
    optimize: { ...optimize },
  };
}

export function lyricsFontFamily(family: string): string {
  return family
    ? `"${family.replace(/[\\"]/g, '\\$&')}", var(--fontFamilyBase)`
    : 'var(--fontFamilyBase)';
}

/** 歌词的字体样式：字体与字重。设置了字重时改用 `@font-face` 别名，使字重连续变化 */
export function lyricsFontStyle(family: string, weight: number | null) {
  return fontStyleOf(family, weight, lyricsFontFamily);
}

/**
 * 对齐都交给 AMLL 排版：居左保持原样，对唱行靠右。居中时清除对唱标记，文字由样式居中。
 * 居右时把每行的标记取反，所有行按对唱规则靠右，原本的对唱行改为靠左。
 * 返回独立的副本：AMLL 接收可变数组，不能让它改动调用方的数据
 */
export function alignLyricLines(lines: readonly LyricLine[], align: LyricsAlign): LyricLine[] {
  return lines.map((line) => ({
    ...line,
    words: [...line.words],
    isDuet: align === 'left' ? line.isDuet : align === 'right' && !line.isDuet,
  }));
}

export function lyricsProcessConfig(display: LyricsDisplay): LyricDataConfig {
  return {
    optimizeOptions: { ...display.optimize },
    maskMode: display.maskMode,
    maskChar: display.maskChar,
  };
}

export const LYRICS_DISPLAY_KEY = 'defaultTheme.lyrics.display';
export const LYRICS_TYPOGRAPHY_KEY = 'defaultTheme.lyrics.typography';
export const LYRICS_FONTS_KEY = 'defaultTheme.lyrics.fonts';
export const LYRICS_ALIGN_KEY = 'defaultTheme.lyrics.align';
export const LYRICS_PROCESSING_KEY = 'defaultTheme.lyrics.processing';
export const LYRICS_VIEW_KEYS = {
  main: 'defaultTheme.lyrics.mainView',
  immersive: 'defaultTheme.lyrics.immersiveView',
} as const;

const DISPLAY_PREF = defineConfigPref(
  LYRICS_PROCESSING_KEY,
  baseDisplay(DEFAULT_LYRICS_DISPLAY),
  (raw) => {
    if (!raw || typeof raw !== 'object') return undefined;
    const parsed = parseLyricsDisplay(raw);
    return baseDisplay(parsed);
  },
);

export function parseLyricsViewAppearance(raw: unknown, view: LyricsView): LyricsViewAppearance {
  const display = parseLyricsDisplay(raw);
  const source = field(raw, 'fontSource');
  const anchor = field(raw, 'alignAnchor');
  return {
    ...parseTypography(raw),
    fontSource:
      source === 'custom' || source === 'interface'
        ? source
        : view === 'immersive'
          ? 'main'
          : 'interface',
    fontSize: number(
      field(raw, 'fontSize'),
      DEFAULT_LYRICS_DISPLAY.fontSize,
      view === 'immersive' ? (22 * LYRICS_SCALE_RANGE.min) / 100 : LYRICS_FONT_SIZE_RANGE.min,
      view === 'immersive' ? (22 * LYRICS_SCALE_RANGE.max) / 100 : LYRICS_FONT_SIZE_RANGE.max,
    ),
    align: display.align,
    backgroundLast: display.backgroundLast,
    positionMode:
      view === 'immersive' && field(raw, 'positionMode') !== 'custom' ? 'layout' : 'custom',
    alignAnchor: LYRICS_ALIGN_ANCHORS.find((value) => value === anchor) ?? 'center',
    alignPosition: number(field(raw, 'alignPosition'), 0.35, 0, 1),
  };
}

function viewPref(view: LyricsView) {
  return defineConfigPref(
    LYRICS_VIEW_KEYS[view],
    { ...parseLyricsViewAppearance(null, view) },
    (raw) =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...parseLyricsViewAppearance(raw, view) }
        : undefined,
  );
}

const VIEW_PREFS = { main: viewPref('main'), immersive: viewPref('immersive') };
const COMMON_FIELDS = ['autoSeek', 'overscan', 'maskMode', 'maskChar', 'optimize'] as const;

export function startLyricsDisplay(
  store: Store,
  host?: ConfigPrefFace,
  writer?: Pick<ConfigWriter, 'set'>,
) {
  const prefs = startConfigPrefs(
    store,
    [DISPLAY_PREF, VIEW_PREFS.main, VIEW_PREFS.immersive],
    host,
    writer,
  );
  const views = { main: VIEW_PREFS.main.atom, immersive: VIEW_PREFS.immersive.atom };
  const displayFor = (view: LyricsView) =>
    atom<LyricsDisplay>((get) => {
      const main = get(views.main);
      const appearance = get(views[view]);
      const inherited = appearance.fontSource === 'main';
      const family = inherited
        ? main.fontSource === 'custom'
          ? main.fontFamily
          : ''
        : appearance.fontSource === 'custom'
          ? appearance.fontFamily
          : '';
      return {
        ...DEFAULT_LYRICS_DISPLAY,
        ...get(DISPLAY_PREF.atom),
        fontSize: appearance.fontSize,
        align: appearance.align,
        backgroundLast: appearance.backgroundLast,
        translationFontSize: appearance.translationFontSize,
        showTranslation: appearance.showTranslation,
        showRomanization: appearance.showRomanization,
        fontFamily: family,
        fontWeight: inherited ? (appearance.fontWeight ?? main.fontWeight) : appearance.fontWeight,
      };
    });
  const display = displayFor('main');
  const immersiveDisplay = displayFor('immersive');
  function updateView(view: LyricsView, patch: Partial<LyricsViewAppearance>) {
    return prefs.set(VIEW_PREFS[view], {
      ...parseLyricsViewAppearance({ ...store.get(views[view]), ...patch }, view),
    });
  }
  return {
    ready: prefs.ready,
    display,
    immersiveDisplay,
    views,
    updateView,
    persistence: prefs,
    reset(view: LyricsView) {
      return prefs.set(VIEW_PREFS[view], { ...parseLyricsViewAppearance(null, view) });
    },
    async update(patch: Partial<LyricsDisplay>, view: LyricsView = 'main') {
      const parsed = parseLyricsDisplay({ ...store.get(display), ...patch });
      const writes: Promise<boolean>[] = [];
      if (COMMON_FIELDS.some((key) => key in patch))
        writes.push(prefs.set(DISPLAY_PREF, baseDisplay(parsed)));
      if (Object.keys(store.get(views[view])).some((key) => key in patch))
        writes.push(
          updateView(view, {
            ...patch,
            ...('fontFamily' in patch
              ? ({ fontSource: patch.fontFamily ? 'custom' : 'interface' } as const)
              : {}),
          }),
        );
      return (await Promise.all(writes)).every(Boolean);
    },
    dispose: prefs.dispose,
  };
}

export const lyricsDisplayKey = serviceKey<ReturnType<typeof startLyricsDisplay>>('lyricsDisplay');
