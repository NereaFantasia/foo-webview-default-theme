import type {
  LyricDataConfig,
  LyricLine,
  MaskObsceneWordsMode,
} from '@applemusic-like-lyrics/core';
import { atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  oneOf,
  startConfigPrefs,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';

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
  /** 空串沿用界面字体 */
  readonly fontFamily: string;
  /** null 沿用播放器的副行比例，其他值为 CSS 像素 */
  readonly translationFontSize: number | null;
  readonly showTranslation: boolean;
  readonly showRomanization: boolean;
}

export const DEFAULT_LYRICS_TYPOGRAPHY: LyricsTypography = {
  fontFamily: '',
  translationFontSize: null,
  showTranslation: true,
  showRomanization: true,
};

export interface LyricsDisplay extends LyricsTypography {
  readonly fontSize: number;
  /** 歌词的水平对齐；经每行的对唱标记实现，见 `alignLyricLines` */
  readonly align: LyricsAlign;
  readonly autoSeek: boolean;
  readonly overscan: number;
  readonly backgroundLast: boolean;
  readonly maskMode: MaskObsceneWordsMode;
  readonly maskChar: string;
  readonly optimize: Readonly<Record<(typeof LYRICS_OPTIMIZATIONS)[number], boolean>>;
}

/** 歌词字号的取值范围，CSS 像素 */
export const LYRICS_FONT_SIZE_RANGE = { min: 12, max: 48 } as const;

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
  const family = field(raw, 'fontFamily');
  const size = field(raw, 'translationFontSize');
  return {
    fontFamily:
      typeof family === 'string' &&
      family.length <= 200 &&
      [...family].every((char) => char >= ' ' && char.charCodeAt(0) !== 127)
        ? family
        : '',
    translationFontSize:
      typeof size === 'number' && Number.isFinite(size) ? number(size, 16, 10, 48) : null,
    showTranslation: boolean(field(raw, 'showTranslation'), true),
    showRomanization: boolean(field(raw, 'showRomanization'), true),
  };
}

/** 保留原存储格式，字体与副行偏好、对齐各用另一项存档 */
function baseDisplay(value: LyricsDisplay) {
  const { fontSize, autoSeek, overscan, backgroundLast, maskMode, maskChar, optimize } = value;
  return {
    fontSize,
    autoSeek,
    overscan,
    backgroundLast,
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

/**
 * 对齐都交给 AMLL 自己排：居左原样，对唱行靠右；居中清掉对唱标记，字的居中由样式做；居右把每行的标记取反，
 * 所有行按对唱规则靠右，原本的对唱行反过来靠左。返回独立副本，AMLL 收可变数组，不让它改到调用方的数据
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

const DISPLAY_PREF = defineConfigPref(
  'defaultTheme.lyrics.display',
  baseDisplay(DEFAULT_LYRICS_DISPLAY),
  (raw) => {
    if (!raw || typeof raw !== 'object') return undefined;
    const parsed = parseLyricsDisplay(raw);
    return baseDisplay(parsed);
  },
);
export const LYRICS_DISPLAY_KEY = DISPLAY_PREF.key;

const TYPOGRAPHY_PREF = defineConfigPref(
  'defaultTheme.lyrics.typography',
  { ...DEFAULT_LYRICS_TYPOGRAPHY },
  (raw) =>
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...parseTypography(raw) } : undefined,
);
export const LYRICS_TYPOGRAPHY_KEY = TYPOGRAPHY_PREF.key;
const TYPOGRAPHY_FIELDS = [
  'fontFamily',
  'translationFontSize',
  'showTranslation',
  'showRomanization',
] as const;

const ALIGN_PREF = defineConfigPref<LyricsAlign>(
  'defaultTheme.lyrics.align',
  DEFAULT_LYRICS_DISPLAY.align,
  oneOf(LYRICS_ALIGNS),
);
export const LYRICS_ALIGN_KEY = ALIGN_PREF.key;

export function startLyricsDisplay(
  store: Store,
  host?: ConfigPrefFace,
  writer?: Pick<ConfigWriter, 'set'>,
) {
  const prefs = startConfigPrefs(store, [DISPLAY_PREF, TYPOGRAPHY_PREF, ALIGN_PREF], host, writer);
  const display = atom<LyricsDisplay>((get) => ({
    ...get(DISPLAY_PREF.atom),
    ...get(TYPOGRAPHY_PREF.atom),
    align: get(ALIGN_PREF.atom),
  }));
  return {
    ready: prefs.ready,
    display,
    persistence: prefs,
    async update(patch: Partial<LyricsDisplay>) {
      const parsed = parseLyricsDisplay({ ...store.get(display), ...patch });
      const writes: Promise<boolean>[] = [];
      if (
        Object.keys(patch).some(
          (key) => key !== 'align' && !TYPOGRAPHY_FIELDS.some((field) => field === key),
        )
      )
        writes.push(prefs.set(DISPLAY_PREF, baseDisplay(parsed)));
      if (TYPOGRAPHY_FIELDS.some((key) => key in patch))
        writes.push(prefs.set(TYPOGRAPHY_PREF, { ...parseTypography(parsed) }));
      if ('align' in patch) writes.push(prefs.set(ALIGN_PREF, parsed.align));
      return (await Promise.all(writes)).every(Boolean);
    },
    dispose: prefs.dispose,
  };
}

export const lyricsDisplayKey = serviceKey<ReturnType<typeof startLyricsDisplay>>('lyricsDisplay');
