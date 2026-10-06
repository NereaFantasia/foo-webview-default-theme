import type { ConfigWriter } from '../host/configWrite.ts';
import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 歌词播放器的动效档位：`amll` 照 AMLL 自己的缺省，`winui` 照 Windows 11 的动效参数，`custom` 用
 * 用户逐项调过的那一套。只有 `winui` 一档受「动效遵循 Windows 11」约束。
 */
export const LYRICS_MOTION_PRESETS = ['amll', 'winui', 'custom'] as const;
export type LyricsMotionPreset = (typeof LYRICS_MOTION_PRESETS)[number];

export const LYRICS_ALIGN_ANCHORS = ['top', 'center', 'bottom'] as const;
export type LyricsAlignAnchor = (typeof LYRICS_ALIGN_ANCHORS)[number];

export interface LyricsSpring {
  readonly mass: number;
  readonly damping: number;
  readonly stiffness: number;
}

/** 三次贝塞尔的两个控制点 `[x1, y1, x2, y2]`，同 CSS `cubic-bezier()`。 */
export type LyricsCurve = readonly [number, number, number, number];

/**
 * AMLL 实际生效的全部可调项。纵向滚动弹簧不在里面：AMLL 每换一行按行间隔重算它的刚度与阻尼，设了也会被
 * 覆盖；横向弹簧在 DOM 播放器里没有实现。
 */
export interface LyricsMotion {
  /** 关掉时 AMLL 不逐帧算弹簧，行的移动改走 CSS 过渡，时长与曲线取下面两项。 */
  readonly spring: boolean;
  /** 非当前行缩小、当前行复原用的弹簧；`scale` 关掉时不起作用。 */
  readonly scaleSpring: LyricsSpring;
  /** 关弹簧时行移动的过渡时长，毫秒。 */
  readonly transitionMs: number;
  readonly transitionCurve: LyricsCurve;
  /** 离当前行越远越模糊。 */
  readonly blur: boolean;
  /** 非当前行略微缩小。 */
  readonly scale: boolean;
  readonly hidePassedLines: boolean;
  /** 逐字渐变遮罩的过渡宽度，单位是一个字的宽度；越大越柔。 */
  readonly wordFadeWidth: number;
  /** 当前行对齐到容器的哪个位置：`alignPosition` 是从上往下的比例，0 到 1。 */
  readonly alignAnchor: LyricsAlignAnchor;
  readonly alignPosition: number;
}

/** AMLL 0.6.0 的缺省值；关弹簧后的过渡取它样式表里的 `transform .5s`，曲线是 CSS 缺省的 `ease`。 */
const AMLL_MOTION: LyricsMotion = {
  spring: true,
  scaleSpring: { mass: 2, damping: 25, stiffness: 100 },
  transitionMs: 500,
  transitionCurve: [0.25, 0.1, 0.25, 1],
  blur: true,
  scale: true,
  hidePassedLines: false,
  wordFadeWidth: 0.5,
  alignAnchor: 'center',
  alignPosition: 0.35,
};

/**
 * 行移动采用 Windows 11 的点到点曲线 `(0.55,0.55,0,1)`，时长为歌词连续滚动设为 500 ms；
 * 不模糊、不缩放。
 */
const WINUI_MOTION: LyricsMotion = {
  ...AMLL_MOTION,
  spring: false,
  transitionMs: 500,
  transitionCurve: [0.55, 0.55, 0, 1],
  blur: false,
  scale: false,
};

export const LYRICS_MOTION_PRESET_VALUES: Readonly<
  Record<Exclude<LyricsMotionPreset, 'custom'>, LyricsMotion>
> = { amll: AMLL_MOTION, winui: WINUI_MOTION };

export interface LyricsMotionPref {
  readonly preset: LyricsMotionPreset;
  /** 自定义档的那一套；没调过时是 AMLL 的缺省。切到别的档时留着，切回来照旧。 */
  readonly custom: LyricsMotion;
}

const DEFAULT_PREF: LyricsMotionPref = { preset: 'amll', custom: AMLL_MOTION };

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function number(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

function oneOf<T extends string>(values: readonly T[], raw: unknown): T | undefined {
  return values.find((value) => value === raw);
}

function parseSpring(raw: unknown): LyricsSpring | undefined {
  const mass = number(field(raw, 'mass'), 0.1, 10);
  const damping = number(field(raw, 'damping'), 1, 100);
  const stiffness = number(field(raw, 'stiffness'), 1, 1000);
  return mass === undefined || damping === undefined || stiffness === undefined
    ? undefined
    : { mass, damping, stiffness };
}

/** 横坐标必须在 0 到 1 之间，CSS 不收越界的值；纵坐标放宽到 −1 到 2，允许回弹。 */
function parseCurve(raw: unknown): LyricsCurve | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const [x1, y1, x2, y2] = [
    number(raw[0], 0, 1),
    number(raw[1], -1, 2),
    number(raw[2], 0, 1),
    number(raw[3], -1, 2),
  ];
  return x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined
    ? undefined
    : [x1, y1, x2, y2];
}

function boolean(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

/** 逐项校验，缺的或不合法的项回到 AMLL 的缺省，越界的夹回区间。config 里的东西谁都能改。 */
export function parseLyricsMotion(raw: unknown): LyricsMotion {
  const d = AMLL_MOTION;
  return {
    spring: boolean(field(raw, 'spring')) ?? d.spring,
    scaleSpring: parseSpring(field(raw, 'scaleSpring')) ?? d.scaleSpring,
    transitionMs: number(field(raw, 'transitionMs'), 0, 2000) ?? d.transitionMs,
    transitionCurve: parseCurve(field(raw, 'transitionCurve')) ?? d.transitionCurve,
    blur: boolean(field(raw, 'blur')) ?? d.blur,
    scale: boolean(field(raw, 'scale')) ?? d.scale,
    hidePassedLines: boolean(field(raw, 'hidePassedLines')) ?? d.hidePassedLines,
    wordFadeWidth: number(field(raw, 'wordFadeWidth'), 0.0001, 2) ?? d.wordFadeWidth,
    alignAnchor: oneOf(LYRICS_ALIGN_ANCHORS, field(raw, 'alignAnchor')) ?? d.alignAnchor,
    alignPosition: number(field(raw, 'alignPosition'), 0, 1) ?? d.alignPosition,
  };
}

function parsePref(raw: unknown): LyricsMotionPref | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  return {
    preset: oneOf(LYRICS_MOTION_PRESETS, field(raw, 'preset')) ?? DEFAULT_PREF.preset,
    custom: parseLyricsMotion(field(raw, 'custom')),
  };
}

function toConfig(pref: LyricsMotionPref) {
  const { custom } = pref;
  return {
    preset: pref.preset,
    custom: {
      ...custom,
      scaleSpring: { ...custom.scaleSpring },
      transitionCurve: [...custom.transitionCurve],
    },
  };
}

const MOTION_PREF = defineConfigPref(
  'defaultTheme.lyrics.motion',
  toConfig(DEFAULT_PREF),
  (raw) => {
    const pref = parsePref(raw);
    return pref ? toConfig(pref) : undefined;
  },
);
export const LYRICS_MOTION_KEY = MOTION_PREF.key;

/** 这一档实际用的那一套参数。 */
export function effectiveLyricsMotion(pref: LyricsMotionPref): LyricsMotion {
  return pref.preset === 'custom' ? pref.custom : LYRICS_MOTION_PRESET_VALUES[pref.preset];
}

export interface LyricsMotionService {
  readonly persistence: ConfigPersistence;
  /** 存档读回或补写完时兑现，不会拒绝；之前用的是缺省档。 */
  readonly ready: Promise<void>;
  readonly pref: Atom<LyricsMotionPref>;
  readonly motion: Atom<LyricsMotion>;
  choosePreset(preset: LyricsMotionPreset): void;
  /**
   * 改几项并切到自定义档。改的是此刻生效的那一套：在 WinUI 3 档上只调一项，其余各项仍是 WinUI 3 的值。
   */
  customize(patch: Partial<LyricsMotion>): void;
  dispose(): void;
}

export const lyricsMotionKey = serviceKey<LyricsMotionService>('lyricsMotion');

/** 动效档位随 profile 记在宿主 config 的 `defaultTheme.lyrics.motion`。 */
export function startLyricsMotion(
  store: Store,
  host?: ConfigPrefFace,
  writer?: Pick<ConfigWriter, 'set'>,
): LyricsMotionService {
  const prefs = startConfigPrefs(store, [MOTION_PREF], host, writer);
  const pref = atom((get) => parsePref(get(MOTION_PREF.atom)) ?? DEFAULT_PREF);
  return {
    ready: prefs.ready,
    persistence: prefs,
    pref,
    motion: atom((get) => effectiveLyricsMotion(get(pref))),
    choosePreset(preset) {
      prefs.set(MOTION_PREF, toConfig({ ...store.get(pref), preset }));
    },
    customize(patch) {
      const base = effectiveLyricsMotion(store.get(pref));
      const custom = parseLyricsMotion({ ...base, ...patch });
      prefs.set(MOTION_PREF, toConfig({ preset: 'custom', custom }));
    },
    dispose: prefs.dispose,
  };
}
