import { CURVE, DURATION_MS, motionDuration } from './timing.ts';

/** 一个元素上的一段 Web Animations 动画。 */
export interface MotionLeg {
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
}

/** 换步时新内容横移的距离，像素：取页内区域那一档，整数免得结束时差一个设备像素。 */
export const STEP_DISTANCE_PX = 20;

/**
 * 裁剪底板时上、左、右三边往外留的余量，像素。对话框的阴影向外铺开约这么远，裁剪框只收底边，
 * 其余三边让出余量，阴影才不会在动画期间整圈消失。
 */
export const SHADOW_ALLOWANCE_PX = 96;

export type StepDirection = 'forward' | 'back';

function layer(
  keyframes: Keyframe[],
  ms: number,
  easing: string,
  reduced: boolean,
  fill: FillMode = 'none',
): MotionLeg {
  return { keyframes, options: { duration: motionDuration(ms, reduced), easing, fill } };
}

/**
 * 新一步的标题与正文：前进从右侧、后退从左侧横移 20 px 进来，250 ms 直接进场，配 83 ms 线性淡入。
 * 旧内容当帧换掉，不留离场层。
 */
export function stepEnter(direction: StepDirection, reduced: boolean): readonly MotionLeg[] {
  const from = direction === 'forward' ? STEP_DISTANCE_PX : -STEP_DISTANCE_PX;
  return [
    layer([{ opacity: 0 }, { opacity: 1 }], DURATION_MS.faster, CURVE.linear.timing, reduced),
    layer(
      [{ transform: `translateX(${from}px)` }, { transform: 'none' }],
      DURATION_MS.normal,
      CURVE.decelerateMid.timing,
      reduced,
    ),
  ];
}

function clip(bottom: number): string {
  const out = `-${SHADOW_ALLOWANCE_PX}px`;
  return `inset(${out} ${out} ${bottom}px ${out})`;
}

/**
 * 底边从 `from` 高移到 `to` 高（像素），底板裁剪与页脚位移走同一段点到点。变高时布局已经到了 `to`：
 * 底板从 `from` 露出到 `to`，页脚从旧位置下移。变矮时调用方要在动画期间把底板钉在 `from` 高：
 * 底板从 `from` 收回到 `to`，页脚上移，播完停在终态，由调用方撤掉钉住的高度与两段动画。
 * 高度没变时答 null。
 */
export function edgeMove(
  from: number,
  to: number,
  ms: number,
  reduced: boolean,
): { readonly surface: MotionLeg; readonly footer: MotionLeg } | null {
  const delta = Math.round(to - from);
  if (delta === 0) return null;
  const easing = CURVE.pointToPoint.timing;
  if (delta > 0) {
    return {
      surface: layer([{ clipPath: clip(delta) }, { clipPath: clip(0) }], ms, easing, reduced),
      footer: layer(
        [{ transform: `translateY(${-delta}px)` }, { transform: 'none' }],
        ms,
        easing,
        reduced,
      ),
    };
  }
  return {
    surface: layer(
      [{ clipPath: clip(0) }, { clipPath: clip(-delta) }],
      ms,
      easing,
      reduced,
      'forwards',
    ),
    footer: layer(
      [{ transform: 'none' }, { transform: `translateY(${delta}px)` }],
      ms,
      easing,
      reduced,
      'forwards',
    ),
  };
}

/**
 * 一块插进来时，跟在它后面的内容先让位：从原来的位置（上移 `shift` 像素）回到新位置，167 ms 点到点；
 * 这一块自己等让位播完再 83 ms 淡入，等待期间保持透明。
 */
export function insertMotion(
  shift: number,
  reduced: boolean,
): { readonly following: MotionLeg; readonly inserted: MotionLeg } {
  const room = Math.round(shift);
  return {
    following: layer(
      [{ transform: `translateY(${-room}px)` }, { transform: 'none' }],
      DURATION_MS.fast,
      CURVE.pointToPoint.timing,
      reduced,
    ),
    inserted: {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      options: {
        duration: motionDuration(DURATION_MS.faster, reduced),
        delay: motionDuration(DURATION_MS.fast, reduced),
        easing: CURVE.linear.timing,
        fill: 'backwards',
      },
    },
  };
}
