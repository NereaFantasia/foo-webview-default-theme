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
import type { LyricsView } from './lyricsSettings.ts';

/**
 * 歌词播放器的动效档位：`amll` 使用 AMLL 自身的缺省值，`winui` 使用 Windows 11 的动效参数，
 * `custom` 使用用户逐项调整的参数。只有 `winui` 档受「动效遵循 Windows 11」的约束
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

/** 三次贝塞尔曲线的两个控制点 `[x1, y1, x2, y2]`，与 CSS `cubic-bezier()` 相同 */
export type LyricsCurve = readonly [number, number, number, number];

/**
 * AMLL 实际生效的全部可调项。不含纵向滚动弹簧：AMLL 每换一行都按行间隔重新计算它的刚度与阻尼，
 * 设置的值会被覆盖。也不含横向弹簧，DOM 播放器没有实现它
 */
export interface LyricsMotion {
  /** 关闭时 AMLL 不再逐帧计算弹簧，行的移动改用 CSS 过渡，时长与曲线取 `transitionMs` 与 `transitionCurve` */
  readonly spring: boolean;
  /** 非当前行缩小与当前行复原所用的弹簧，`scale` 关闭时不生效 */
  readonly scaleSpring: LyricsSpring;
  /** 关闭弹簧时行移动的过渡时长（毫秒） */
  readonly transitionMs: number;
  readonly transitionCurve: LyricsCurve;
  /** 离当前行越远越模糊 */
  readonly blur: boolean;
  /** 非当前行略微缩小 */
  readonly scale: boolean;
  readonly hidePassedLines: boolean;
  /** 逐字渐变遮罩的过渡宽度，以一个字的宽度为单位。数值越大，过渡越柔和 */
  readonly wordFadeWidth: number;
  /** 当前行在容器中的对齐位置。`alignPosition` 是从上到下的比例，取值 0 到 1 */
  readonly alignAnchor: LyricsAlignAnchor;
  readonly alignPosition: number;
}

/** AMLL 0.6.0 的缺省值。关闭弹簧后的过渡取自 AMLL 样式表中的 `transform .5s`，曲线是 CSS 缺省的 `ease` */
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
 * 行移动使用 Windows 11 的点到点曲线 `(0.55,0.55,0,1)`，时长按歌词的连续滚动定为 500 ms。
 * 不模糊，不缩放
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
  /** 自定义档的参数，未调整时为 AMLL 的缺省值。切换到其他档时保留，切回后照常使用 */
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

/** 横坐标须在 0 到 1 之间，CSS 不接受越界的值。纵坐标放宽到 −1 到 2，允许回弹 */
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

/** 逐项校验：缺失或不合法的项取 AMLL 的缺省值，越界的值限制到区间内。config 中的值可能被任何程序修改 */
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

export function parseLyricsMotionPref(raw: unknown): LyricsMotionPref | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  return {
    preset: oneOf(LYRICS_MOTION_PRESETS, field(raw, 'preset')) ?? DEFAULT_PREF.preset,
    custom: parseLyricsMotion(field(raw, 'custom')),
  };
}

export function lyricsMotionConfig(pref: LyricsMotionPref) {
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

export const LYRICS_MOTION_KEY = 'defaultTheme.lyrics.motion';
export const LYRICS_VIEW_MOTION_KEYS = {
  main: 'defaultTheme.lyrics.mainMotion',
  immersive: 'defaultTheme.lyrics.immersiveMotion',
} as const;

function motionPref(view: LyricsView) {
  return defineConfigPref(
    LYRICS_VIEW_MOTION_KEYS[view],
    lyricsMotionConfig(DEFAULT_PREF),
    (raw) => {
      const pref = parseLyricsMotionPref(raw);
      return pref ? lyricsMotionConfig(pref) : undefined;
    },
  );
}

const MOTION_PREFS = { main: motionPref('main'), immersive: motionPref('immersive') };

/** 该档实际使用的参数 */
export function effectiveLyricsMotion(pref: LyricsMotionPref): LyricsMotion {
  return pref.preset === 'custom' ? pref.custom : LYRICS_MOTION_PRESET_VALUES[pref.preset];
}

export interface LyricsMotionService {
  readonly persistence: ConfigPersistence;
  /** 存档读回或补写完成时兑现，不会拒绝。兑现之前使用缺省档 */
  readonly ready: Promise<void>;
  readonly pref: Atom<LyricsMotionPref>;
  readonly motion: Atom<LyricsMotion>;
  readonly views: Readonly<
    Record<
      LyricsView,
      {
        readonly pref: Atom<LyricsMotionPref>;
        readonly motion: Atom<LyricsMotion>;
      }
    >
  >;
  choosePreset(preset: LyricsMotionPreset, view?: LyricsView): void;
  /**
   * 修改部分参数并切换到自定义档。修改基于当前生效的参数：在 WinUI 3 档上只调整一项时，其余各项仍是 WinUI 3 的值
   */
  customize(patch: Partial<LyricsMotion>, view?: LyricsView): void;
  reset(view: LyricsView): Promise<boolean>;
  dispose(): void;
}

export const lyricsMotionKey = serviceKey<LyricsMotionService>('lyricsMotion');

/** 当前行在容器中的位置，由各视图的显示偏好决定 */
export interface LyricsPlacement {
  readonly alignAnchor: LyricsAlignAnchor;
  readonly alignPosition: number;
}

/**
 * 启动歌词动效服务。主视图与沉浸视图分别保存动效，切换预设时保留各自的自定义参数。
 * 传入 `placements` 时，各视图的当前行位置取自它，动效档位中的位置不再生效
 */
export function startLyricsMotion(
  store: Store,
  host?: ConfigPrefFace,
  writer?: Pick<ConfigWriter, 'set'>,
  placements?: Readonly<Record<LyricsView, Atom<LyricsPlacement>>>,
): LyricsMotionService {
  const prefs = startConfigPrefs(store, [MOTION_PREFS.main, MOTION_PREFS.immersive], host, writer);
  const forView = (view: LyricsView) => {
    const pref = atom((get) => parseLyricsMotionPref(get(MOTION_PREFS[view].atom)) ?? DEFAULT_PREF);
    const placement = placements?.[view];
    return {
      pref,
      motion: atom((get) => {
        const motion = effectiveLyricsMotion(get(pref));
        if (!placement) return motion;
        const { alignAnchor, alignPosition } = get(placement);
        return { ...motion, alignAnchor, alignPosition };
      }),
    };
  };
  const views = { main: forView('main'), immersive: forView('immersive') };
  return {
    ready: prefs.ready,
    persistence: prefs,
    pref: views.main.pref,
    motion: views.main.motion,
    views,
    choosePreset(preset, view = 'main') {
      prefs.set(MOTION_PREFS[view], lyricsMotionConfig({ ...store.get(views[view].pref), preset }));
    },
    customize(patch, view = 'main') {
      const base = effectiveLyricsMotion(store.get(views[view].pref));
      const custom = parseLyricsMotion({ ...base, ...patch });
      prefs.set(MOTION_PREFS[view], lyricsMotionConfig({ preset: 'custom', custom }));
    },
    reset(view) {
      return prefs.set(MOTION_PREFS[view], lyricsMotionConfig(DEFAULT_PREF));
    },
    dispose: prefs.dispose,
  };
}
