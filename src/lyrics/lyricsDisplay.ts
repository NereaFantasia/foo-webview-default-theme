import type { LyricDataConfig, MaskObsceneWordsMode } from '@applemusic-like-lyrics/core';
import { defineConfigPref, startConfigPrefs, type ConfigPrefFace } from '../host/configPref.ts';
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

export interface LyricsDisplay {
  readonly fontSize: number;
  readonly autoSeek: boolean;
  readonly overscan: number;
  readonly backgroundLast: boolean;
  readonly maskMode: MaskObsceneWordsMode;
  readonly maskChar: string;
  readonly optimize: Readonly<Record<(typeof LYRICS_OPTIMIZATIONS)[number], boolean>>;
}

export const DEFAULT_LYRICS_DISPLAY: LyricsDisplay = {
  fontSize: 22,
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
    fontSize: number(field(raw, 'fontSize'), d.fontSize, 12, 48),
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

export function lyricsProcessConfig(display: LyricsDisplay): LyricDataConfig {
  return {
    optimizeOptions: { ...display.optimize },
    maskMode: display.maskMode,
    maskChar: display.maskChar,
  };
}

const DISPLAY_PREF = defineConfigPref(
  'defaultTheme.lyrics.display',
  { ...DEFAULT_LYRICS_DISPLAY, optimize: { ...DEFAULT_LYRICS_DISPLAY.optimize } },
  (raw) => {
    if (!raw || typeof raw !== 'object') return undefined;
    const parsed = parseLyricsDisplay(raw);
    return { ...parsed, optimize: { ...parsed.optimize } };
  },
);
export const LYRICS_DISPLAY_KEY = DISPLAY_PREF.key;

export function startLyricsDisplay(
  store: Store,
  host?: ConfigPrefFace,
  writer?: Pick<ConfigWriter, 'set'>,
) {
  const prefs = startConfigPrefs(store, [DISPLAY_PREF], host, writer);
  return {
    ready: prefs.ready,
    display: DISPLAY_PREF.atom,
    persistence: prefs,
    update(patch: Partial<LyricsDisplay>) {
      const parsed = parseLyricsDisplay({ ...store.get(DISPLAY_PREF.atom), ...patch });
      return prefs.set(DISPLAY_PREF, { ...parsed, optimize: { ...parsed.optimize } });
    },
    dispose: prefs.dispose,
  };
}

export const lyricsDisplayKey = serviceKey<ReturnType<typeof startLyricsDisplay>>('lyricsDisplay');
