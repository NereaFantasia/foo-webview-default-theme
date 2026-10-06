import { tokens } from '@fluentui/react-components';
import { lightTheme } from '../theme/themes.ts';

/**
 * Windows 11 的动效时长，毫秒。进场与已在场元素的移动按元素大小取 fast / normal / slow，
 * 退场取 fast，单纯的淡入淡出取 faster。用原值，不取最近的 Fluent duration token：
 * Fluent 只有 250 ms（durationGentle）对得上，83、167、333 在 Fluent 里是 100、150、300。
 */
export const DURATION_MS = { faster: 83, fast: 167, normal: 250, slow: 333 } as const;
export const PANE_DURATION_MS = { overlayOpen: 350, overlayClose: 120 } as const;
export type DurationName = keyof typeof DURATION_MS;

/**
 * 减弱动效时的时长。不取 0：时长为 0 的 CSS 过渡根本不开始，也就不发 transitionend，
 * 等「动画结束」的逻辑会卡住；1 ms 在一帧之内到终态，结束事件照常发。Fluent 自带的动效也是这么缩的。
 */
export const REDUCED_MOTION_MS = 1;

export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? REDUCED_MOTION_MS : ms;
}

/** 把线性进度（0–1）换成缓动后的进度。 */
export type Ease = (progress: number) => number;

export interface MotionCurve {
  /**
   * 写进样式的取值。与 Fluent token 相同的曲线是 token 的 CSS 变量（`tokens.curveDecelerateMid` 这类），
   * 只在 FluentProvider 之下有值；其余是字面量。
   */
  readonly css: string;
  /** `cubic-bezier()` 字面量。Web Animations 的 easing 不解析 CSS 变量，要用这个。 */
  readonly timing: string;
  /** 逐帧推进的动画（比如跟着展开同步滚动）用它求每一帧的位置，与样式里的曲线一致。 */
  readonly ease: Ease;
}

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` 的求值。x1、x2 在 0–1 之间时 x 随曲线参数单调，
 * 二分求出参数再取 y；进度超出 0–1 按两端算。
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const at = (p1: number, p2: number, s: number) =>
    3 * p1 * s * (1 - s) ** 2 + 3 * p2 * s * s * (1 - s) + s ** 3;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0;
    let high = 1;
    while (high - low > 1e-7) {
      const middle = (low + high) / 2;
      if (at(x1, x2, middle) < progress) low = middle;
      else high = middle;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

const BEZIER = /^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^,)]+)\)$/;

/** 曲线取自 Fluent token：样式里写 token，逐帧与 Web Animations 用主题对象里的同一个值。 */
function tokenCurve(css: string, timing: string): MotionCurve {
  const values = BEZIER.exec(timing.replace(/\s+/g, ''))?.slice(1).map(Number) ?? [];
  const [x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN] = values;
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    throw new Error(`曲线 token 的取值不是 cubic-bezier()：${timing}`);
  }
  return { css, timing, ease: cubicBezier(x1, y1, x2, y2) };
}

function customCurve(x1: number, y1: number, x2: number, y2: number): MotionCurve {
  const timing = `cubic-bezier(${x1},${y1},${x2},${y2})`;
  return { css: timing, timing, ease: cubicBezier(x1, y1, x2, y2) };
}

/**
 * Windows 11 的缓动曲线。前五条与 Fluent token 完全相同，直接用 token；其余 Fluent 没有，在这里定义。
 */
export const CURVE = {
  /** 直接进场与直接退场（Fast Out, Slow In）；折叠卡展开、菜单与对话框打开也用它。 */
  decelerateMid: tokenCurve(tokens.curveDecelerateMid, lightTheme.curveDecelerateMid),
  /** 轻退场（Slow Out, Fast In）。 */
  accelerateMid: tokenCurve(tokens.curveAccelerateMid, lightTheme.curveAccelerateMid),
  /** 窄窗侧边栏浮层的滑入滑出、连接动画的后退、导航选中条的收拢段。 */
  decelerateMax: tokenCurve(tokens.curveDecelerateMax, lightTheme.curveDecelerateMax),
  /** 导航选中条的拉伸段。 */
  accelerateMax: tokenCurve(tokens.curveAccelerateMax, lightTheme.curveAccelerateMax),
  /** 淡入淡出。 */
  linear: tokenCurve(tokens.curveLinear, lightTheme.curveLinear),
  /** 已在场元素从一处移到另一处（点到点）。 */
  pointToPoint: customCurve(0.55, 0.55, 0, 1),
  /** 侧边栏在展开与图标态之间切换（与内容并排的窗格）。 */
  pane: customCurve(0, 0.35, 0.15, 1),
  /** 折叠卡收起。 */
  collapse: customCurve(1, 1, 0, 1),
  /** 列表项的选中指示条从无到有纵向放大（WinUI ListViewItem）。 */
  indicator: customCurve(0.167, 0.167, 0, 1),
} as const;

function durationVariables(ms: (original: number) => number): Record<`--${string}`, string> {
  const variables: Record<`--${string}`, string> = {};
  for (const [name, original] of Object.entries(DURATION_MS)) {
    variables[`--motion-${name}`] = `${ms(original)}ms`;
  }
  return variables;
}

/**
 * 动效的 CSS 变量，挂在主题根上：CSS Modules 里写 `var(--motion-fast)`、`var(--motion-curve-pane)`，
 * makeStyles 里用 `durationVar`。与 Fluent token 相同的曲线直接写 token，这里只放 Fluent 缺的三条。
 */
export const MOTION_VARIABLES: Readonly<Record<`--${string}`, string>> = {
  ...durationVariables((original) => original),
  '--motion-curve-point-to-point': CURVE.pointToPoint.timing,
  '--motion-curve-pane': CURVE.pane.timing,
  '--motion-curve-collapse': CURVE.collapse.timing,
};

/** 减弱动效时覆盖上面的时长变量，写样式的一方不必自己判断。 */
export const REDUCED_MOTION_VARIABLES: Readonly<Record<`--${string}`, string>> = durationVariables(
  () => REDUCED_MOTION_MS,
);

/** makeStyles 里取时长：`durationVar('fast')` 得到 `var(--motion-fast)`，减弱动效时它自动是 1 ms。 */
export function durationVar(name: DurationName): string {
  return `var(--motion-${name})`;
}
