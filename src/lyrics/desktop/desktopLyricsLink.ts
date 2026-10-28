import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core';
import {
  DESKTOP_LYRICS_ALIGNS,
  DESKTOP_LYRICS_MODES,
  DESKTOP_LYRICS_MOTION_PRESETS,
  parseDesktopLyricsBounds,
  parseDesktopLyricsSizeMemory,
  type DesktopLyricsAlign,
  type DesktopLyricsBounds,
  type DesktopLyricsMode,
  type DesktopLyricsMotionPreset,
  type DesktopLyricsSizeMemory,
} from './desktopLyricsPrefs.ts';

/**
 * 主窗口与桌面歌词弹窗之间的约定。主窗口把要显示的东西写进宿主的共享状态，弹窗先订阅再初读；
 * 弹窗的命令经 `window.sendMessage` 发给主窗口。两边收到的都是别的页面写的 JSON，用前逐项校验
 */
export const DESKTOP_LYRICS_VIEW_KEY = 'defaultTheme.desktopLyrics.view';
export const DESKTOP_LYRICS_LINES_KEY = 'defaultTheme.desktopLyrics.lines';
/** 消息外层的标记：主窗口只认带它的消息 */
export const DESKTOP_LYRICS_CHANNEL = 'defaultTheme.desktopLyrics';

/** 弹窗上要显示的文字，由主窗口按界面语言译好送过来，弹窗不带语言包 */
export const DESKTOP_LYRICS_LABELS = [
  'previous',
  'play',
  'pause',
  'next',
  'earlier',
  'later',
  'align',
  'mode',
  'lock',
  'unlock',
  'settings',
  'close',
] as const;
export type DesktopLyricsLabel = (typeof DESKTOP_LYRICS_LABELS)[number];

export interface DesktopLyricsView {
  readonly labels: Readonly<Record<DesktopLyricsLabel, string>>;
  readonly locked: boolean;
  readonly align: DesktopLyricsAlign;
  readonly motionPreset: DesktopLyricsMotionPreset;
  readonly mode: DesktopLyricsMode;
  readonly multilineSize: DesktopLyricsSizeMemory | null;
  /** 当前行的字号，CSS 像素 */
  readonly fontSize: number;
  /** 已唱色；null 是只用一层、照 AMLL 原样淡显未唱部分 */
  readonly sung: string | null;
  /** 未唱色；null 用界面的前景色 */
  readonly unsung: string | null;
  /** 底板的颜色；null 是中性深色。只在 `plate` 为真时用 */
  readonly tint: string | null;
  readonly plate: boolean;
  /** 底板的不透明度，0.1 到 1 */
  readonly plateOpacity: number;
  /** 光晕颜色；null 用中性深色。只在没有底板时用 */
  readonly glow: string | null;
  readonly showTranslation: boolean;
  readonly showRomanization: boolean;
  /** 歌词的时间偏移，秒，同右侧卡的校时 */
  readonly offset: number;
  readonly title: string;
  readonly artist: string;
  /** 主窗口正在前台显示歌词，弹窗淡出 */
  readonly hidden: boolean;
}

/** `lines` 为 null 是没有带时间轴的歌词，弹窗显示曲名与艺人 */
export interface DesktopLyricsLines {
  /** 每换一份歌词换一个；弹窗按它判重，同一份不重新交给播放器 */
  readonly id: string;
  readonly lines: readonly LyricLine[] | null;
}

export type DesktopLyricsCommand =
  | { readonly type: 'offset'; readonly delta: number }
  | { readonly type: 'seek'; readonly id: string; readonly seconds: number }
  | {
      readonly type: 'mode';
      readonly mode: DesktopLyricsMode;
      readonly bounds: DesktopLyricsBounds;
    }
  | { readonly type: 'align' }
  | { readonly type: 'lock'; readonly locked: boolean }
  | { readonly type: 'close' }
  | { readonly type: 'settings' }
  | { readonly type: 'bounds'; readonly bounds: DesktopLyricsBounds }
  /** 主窗口发给弹窗：移回所在屏幕的下方居中 */
  | { readonly type: 'recenter' };

function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? Reflect.get(raw, key)
    : undefined;
}

const isNumber = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw);
const isString = (raw: unknown): raw is string => typeof raw === 'string';
const isBoolean = (raw: unknown): raw is boolean => typeof raw === 'boolean';
const HEX = /^#[0-9a-f]{6}$/i;
const colorOrNull = (raw: unknown) => (isString(raw) && HEX.test(raw) ? raw : null);

function isLabels(labels: Record<string, unknown>): labels is Record<DesktopLyricsLabel, string> {
  return DESKTOP_LYRICS_LABELS.every((key) => isString(labels[key]));
}

export function parseDesktopLyricsView(raw: unknown): DesktopLyricsView | null {
  const align = DESKTOP_LYRICS_ALIGNS.find((value) => value === field(raw, 'align'));
  const motionPreset =
    DESKTOP_LYRICS_MOTION_PRESETS.find((value) => value === field(raw, 'motionPreset')) ?? 'amll';
  const mode = DESKTOP_LYRICS_MODES.find((value) => value === field(raw, 'mode')) ?? 'multi';
  const fontSize = field(raw, 'fontSize');
  const opacity = field(raw, 'plateOpacity');
  const offset = field(raw, 'offset');
  const title = field(raw, 'title');
  const artist = field(raw, 'artist');
  const locked = field(raw, 'locked');
  const plate = field(raw, 'plate');
  const showTranslation = field(raw, 'showTranslation');
  const showRomanization = field(raw, 'showRomanization');
  const hidden = field(raw, 'hidden');
  const rawLabels = field(raw, 'labels');
  const labels: Record<string, unknown> = Object.fromEntries(
    DESKTOP_LYRICS_LABELS.map((key) => [key, field(rawLabels, key)]),
  );
  if (
    !isLabels(labels) ||
    !align ||
    !isNumber(fontSize) ||
    !isNumber(opacity) ||
    !isNumber(offset) ||
    !isString(title) ||
    !isString(artist) ||
    !isBoolean(locked) ||
    !isBoolean(plate) ||
    !isBoolean(showTranslation) ||
    !isBoolean(showRomanization) ||
    !isBoolean(hidden)
  )
    return null;
  return {
    labels,
    locked,
    align,
    motionPreset,
    mode,
    multilineSize: parseDesktopLyricsSizeMemory(field(raw, 'multilineSize')),
    fontSize: Math.min(96, Math.max(12, fontSize)),
    sung: colorOrNull(field(raw, 'sung')),
    unsung: colorOrNull(field(raw, 'unsung')),
    tint: colorOrNull(field(raw, 'tint')),
    plate,
    plateOpacity: Math.min(1, Math.max(0.1, opacity)),
    glow: colorOrNull(field(raw, 'glow')),
    showTranslation,
    showRomanization,
    offset,
    title,
    artist,
    hidden,
  };
}

function parseWord(raw: unknown): LyricWord | null {
  const word = field(raw, 'word');
  const startTime = field(raw, 'startTime');
  const endTime = field(raw, 'endTime');
  if (!isString(word) || !isNumber(startTime) || !isNumber(endTime)) return null;
  const romanWord = field(raw, 'romanWord');
  const obscene = field(raw, 'obscene');
  const ruby = field(raw, 'ruby');
  const parsed: LyricWord = { word, startTime, endTime };
  if (isString(romanWord)) parsed.romanWord = romanWord;
  if (isBoolean(obscene)) parsed.obscene = obscene;
  if (Array.isArray(ruby)) {
    const bases = ruby.map((item: unknown) => {
      const text = field(item, 'word');
      const start = field(item, 'startTime');
      const end = field(item, 'endTime');
      return isString(text) && isNumber(start) && isNumber(end)
        ? { word: text, startTime: start, endTime: end }
        : null;
    });
    if (bases.every((base) => base !== null)) parsed.ruby = bases;
  }
  return parsed;
}

function parseLine(raw: unknown): LyricLine | null {
  const words = field(raw, 'words');
  const startTime = field(raw, 'startTime');
  const endTime = field(raw, 'endTime');
  const translatedLyric = field(raw, 'translatedLyric');
  const romanLyric = field(raw, 'romanLyric');
  const isBG = field(raw, 'isBG');
  const isDuet = field(raw, 'isDuet');
  if (
    !Array.isArray(words) ||
    !isNumber(startTime) ||
    !isNumber(endTime) ||
    !isString(translatedLyric) ||
    !isString(romanLyric) ||
    !isBoolean(isBG) ||
    !isBoolean(isDuet)
  )
    return null;
  const parsed = words.map((item: unknown) => parseWord(item));
  if (!parsed.every((word) => word !== null)) return null;
  return { words: parsed, startTime, endTime, translatedLyric, romanLyric, isBG, isDuet };
}

/** 有一行不合格就整份不收：缺行的歌词比没有歌词更难看懂 */
export function parseDesktopLyricsLines(raw: unknown): DesktopLyricsLines | null {
  const id = field(raw, 'id');
  const lines = field(raw, 'lines');
  if (!isString(id) || !id) return null;
  if (lines === null) return { id, lines: null };
  if (!Array.isArray(lines)) return null;
  const parsed = lines.map((item: unknown) => parseLine(item));
  return parsed.every((line) => line !== null) ? { id, lines: parsed } : null;
}

/** 共享状态与消息只收 JSON，接口类型的值要先抄成普通对象 */
export function desktopLyricsViewJson(view: DesktopLyricsView) {
  return {
    ...view,
    labels: { ...view.labels },
    multilineSize: view.multilineSize && { ...view.multilineSize },
  };
}

export function desktopLyricsMessage(command: DesktopLyricsCommand) {
  return {
    channel: DESKTOP_LYRICS_CHANNEL,
    command:
      command.type === 'bounds' || command.type === 'mode'
        ? { ...command, bounds: { ...command.bounds } }
        : { ...command },
  };
}

export function parseDesktopLyricsMessage(raw: unknown): DesktopLyricsCommand | null {
  if (field(raw, 'channel') !== DESKTOP_LYRICS_CHANNEL) return null;
  const command = field(raw, 'command');
  const type = field(command, 'type');
  switch (type) {
    case 'seek': {
      const id = field(command, 'id');
      const seconds = field(command, 'seconds');
      return isString(id) && id !== '' && isNumber(seconds) && seconds >= 0
        ? { type, id, seconds }
        : null;
    }
    case 'mode': {
      const mode = DESKTOP_LYRICS_MODES.find((value) => value === field(command, 'mode'));
      const bounds = parseDesktopLyricsBounds(field(command, 'bounds'));
      return mode && bounds ? { type, mode, bounds } : null;
    }
    case 'offset': {
      const delta = field(command, 'delta');
      return isNumber(delta) && Math.abs(delta) <= 10 ? { type, delta } : null;
    }
    case 'lock': {
      const locked = field(command, 'locked');
      return isBoolean(locked) ? { type, locked } : null;
    }
    case 'bounds': {
      const bounds = parseDesktopLyricsBounds(field(command, 'bounds'));
      return bounds ? { type, bounds } : null;
    }
    case 'align':
    case 'close':
    case 'settings':
    case 'recenter':
      return { type };
    default:
      return null;
  }
}
