import { CURVE, DURATION_MS, motionDuration } from './timing.ts';

/**
 * 页面切换的两种过渡，按 Windows 11：`refresh` 是切侧边栏项（新内容上移并淡入），
 * `drill` 是进二级地点（新内容由小放大，旧内容放大淡出）。后退时方向反过来，而且更快。
 */
export type PageTransitionKind = 'refresh' | 'drill';
export type NavDirection = 'forward' | 'back';

/** 一层上的一段 Web Animations 动画。 */
export interface LayerMotion {
  readonly keyframes: Keyframe[];
  readonly options: {
    readonly duration: number;
    readonly easing: string;
    /** 离场的停在终态：动画结束到旧内容真正移走之间隔着一次渲染，不停住会闪回原样一帧。 */
    readonly fill: 'none' | 'forwards';
  };
}

export interface PageMotion {
  /** 新内容，从出场位置走到原位。 */
  readonly enter: readonly LayerMotion[];
  /** 旧内容，淡出离场；全部结束后移走。 */
  readonly exit: readonly LayerMotion[];
}

/** 页面刷新时新内容移动的距离，像素，取整数免得结束时差一个设备像素：前进时从下方上移，后退时从上方下移。 */
export const REFRESH_DISTANCE_PX = 40;
/** 深入时新内容从这个比例放大到原大；后退时旧内容缩到这个比例离场。 */
export const DRILL_NEAR_SCALE = 0.94;
/** 深入时旧内容放大到这个比例离场；后退时新内容从这个比例缩回原大。 */
export const DRILL_FAR_SCALE = 1.04;

function motion(
  keyframes: Keyframe[],
  ms: number,
  easing: string,
  reduced: boolean,
  fill: LayerMotion['options']['fill'] = 'none',
): LayerMotion {
  return { keyframes, options: { duration: motionDuration(ms, reduced), easing, fill } };
}

/**
 * 一次切换里两层各自的动画。新内容按直接进场：位移或缩放用 Fast Out Slow In，页面大，前进取 333 ms，
 * 后退缩到 250 ms；配 83 ms 线性淡入。旧内容：刷新时只做 83 ms 线性淡出；深入时按直接退场，
 * 167 ms 的缩放配 83 ms 淡出。减弱动效时每段都缩到 1 ms，结束事件照常发，等离场结束才移走旧内容的逻辑不受影响。
 */
export function pageTransition(
  kind: PageTransitionKind,
  direction: NavDirection,
  reduced: boolean,
): PageMotion {
  const forward = direction === 'forward';
  const moveMs = forward ? DURATION_MS.slow : DURATION_MS.normal;
  const ease = CURVE.decelerateMid.timing;
  const linear = CURVE.linear.timing;
  const fadeIn = motion([{ opacity: 0 }, { opacity: 1 }], DURATION_MS.faster, linear, reduced);
  const fadeOut = motion(
    [{ opacity: 1 }, { opacity: 0 }],
    DURATION_MS.faster,
    linear,
    reduced,
    'forwards',
  );
  if (kind === 'refresh') {
    const from = forward ? REFRESH_DISTANCE_PX : -REFRESH_DISTANCE_PX;
    const slide = [{ transform: `translateY(${from}px)` }, { transform: 'none' }];
    return { enter: [fadeIn, motion(slide, moveMs, ease, reduced)], exit: [fadeOut] };
  }
  const enterFrom = forward ? DRILL_NEAR_SCALE : DRILL_FAR_SCALE;
  const exitTo = forward ? DRILL_FAR_SCALE : DRILL_NEAR_SCALE;
  const grow = [{ transform: `scale(${enterFrom})` }, { transform: 'none' }];
  const leave = [{ transform: 'none' }, { transform: `scale(${exitTo})` }];
  return {
    enter: [fadeIn, motion(grow, moveMs, ease, reduced)],
    exit: [fadeOut, motion(leave, DURATION_MS.fast, ease, reduced, 'forwards')],
  };
}
