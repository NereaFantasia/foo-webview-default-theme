import { CURVE, DURATION_MS } from '../../../motion/timing.ts';
import type { SwapDirection, TrackSwap } from './trackSwap.ts';

/**
 * 换曲过渡的关键帧，只算不播：文字由 `useTextSwap` 播，封面由 `NowPlayingCover` 播。一段动画是
 * 「关键帧 + 时长与曲线」，同一个元素上的位移与透明度各走各的时长，分成两段。长度 CSS 像素，时长毫秒。
 */
export type MotionTrack = readonly [Keyframe[], KeyframeAnimationOptions];

/** 文字先退后进：`exit` 放完换字，再放 `enter`。 */
export interface TextMotion {
  readonly exit: readonly MotionTrack[];
  readonly enter: readonly MotionTrack[];
}

/** 文字横移的距离：退场往翻页的方向挪，进场从另一侧挪回原位。 */
export const TEXT_SLIDE_PX = 8;
/** 认不出方向时新字从下面上来的距离。 */
export const TEXT_RISE_PX = 4;

const fadeOut: MotionTrack = [
  [{ opacity: 1 }, { opacity: 0 }],
  { duration: DURATION_MS.faster, easing: CURVE.linear.timing },
];
const fadeIn: MotionTrack = [
  [{ opacity: 0 }, { opacity: 1 }],
  { duration: DURATION_MS.faster, easing: CURVE.linear.timing },
];

function slideIn(from: string): MotionTrack {
  return [
    [{ translate: from }, { translate: '0 0' }],
    { duration: DURATION_MS.normal, easing: CURVE.decelerateMid.timing },
  ];
}

/**
 * 换曲时退场 83 ms 线性淡出、按方向横移 8（轻退场曲线）；进场从另一侧 8 处 250 ms 减速到位，配 83 ms 淡入。
 * 认不出方向时只淡出，进场从下面 4 处上来。起播、停止与电台换曲名只做淡变。
 */
export function textSwapMotion(swap: Pick<TrackSwap, 'kind' | 'direction'>): TextMotion {
  if (swap.kind !== 'track') return { exit: [fadeOut], enter: [fadeIn] };
  if (swap.direction === 'none') {
    return { exit: [fadeOut], enter: [fadeIn, slideIn(`0 ${TEXT_RISE_PX}px`)] };
  }
  // 下一首往左翻：旧字往左退，新字从右边来。
  const away = swap.direction === 'next' ? -TEXT_SLIDE_PX : TEXT_SLIDE_PX;
  const leave: MotionTrack = [
    [{ translate: '0 0' }, { translate: `${away}px 0` }],
    { duration: DURATION_MS.faster, easing: CURVE.accelerateMid.timing },
  ];
  return { exit: [fadeOut, leave], enter: [fadeIn, slideIn(`${-away}px 0`)] };
}

/** 新图的样子已经晚于换曲这么久才到，就不再按方向翻，只淡进来，毫秒。 */
export const COVER_LATE_MS = 1000;

/** 封面这一次怎么换：不动、淡变，或按方向翻。 */
export type CoverTurn = 'still' | 'fade' | SwapDirection;

/**
 * 封面换成新图时用哪一种。`swap` 是这一次还没被封面用过的换曲记录，用过了或没有时为 null：同一次换曲
 * 只翻一次，之后的换图（比如图解不出退成占位）直接换。同一张专辑不动；起播与停止只淡变。
 */
export function coverTurnOf(swap: TrackSwap | null, now: number): CoverTurn {
  if (!swap || swap.kind === 'refresh') return 'still';
  if (swap.kind === 'track' && swap.sameCover) return 'still';
  if (swap.kind !== 'track' || now - swap.at > COVER_LATE_MS) return 'fade';
  return swap.direction;
}

export type CoverShape = 'lcd' | 'bar' | 'round';
/** 正在播放条擦除的前沿往哪走：`left` 从右缘往左扫，`right` 反过来，`down` 从上往下。 */
export type CoverWipe = 'left' | 'right' | 'down';

export interface CoverMotion {
  /** 盖上来的新图。 */
  readonly incoming: readonly MotionTrack[];
  /** 底下的旧图。 */
  readonly outgoing: readonly MotionTrack[];
  /** 正在播放条的擦除方向；别的形态没有。 */
  readonly wipe?: CoverWipe;
}

/** 擦除前沿的软边宽，与 `NowPlayingCover.module.css` 的遮罩一致。 */
export const COVER_WIPE_EDGE_PX = 12;

const coverFade: CoverMotion = {
  incoming: [
    [[{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS.fast, easing: CURVE.linear.timing }],
  ],
  outgoing: [],
};

const settle = { duration: DURATION_MS.normal, easing: CURVE.decelerateMid.timing };

/** 底部通栏：新图从翻页的方向整张推进来，旧图同向移出三分之一并淡出。认不出方向时从下面推上来。 */
function pushMotion(direction: SwapDirection): CoverMotion {
  const [from, to] =
    direction === 'next'
      ? ['100% 0', '-33% 0']
      : direction === 'previous'
        ? ['-100% 0', '33% 0']
        : ['0 100%', '0 -33%'];
  return {
    incoming: [[[{ translate: from }, { translate: '0 0' }], settle]],
    outgoing: [
      [[{ translate: '0 0' }, { translate: to }], settle],
      [
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: DURATION_MS.fast, easing: CURVE.linear.timing },
      ],
    ],
  };
}

/** 正在播放条：新图用软边遮罩从一侧擦开，旧图不动。下一首从贴着文字的右缘往左扫。 */
function wipeMotion(direction: SwapDirection): CoverMotion {
  const wipe: CoverWipe =
    direction === 'next' ? 'left' : direction === 'previous' ? 'right' : 'down';
  return {
    incoming: [
      [
        [{ '--cover-wipe': '0px' }, { '--cover-wipe': `calc(100% + ${COVER_WIPE_EDGE_PX}px)` }],
        settle,
      ],
    ],
    outgoing: [],
    wipe,
  };
}

/** 胶囊：新图从 0.85 放大、转 20° 回正位，下一首顺时针转进来；旧图缩到 0.85 淡出。认不出方向时不转。 */
function spinMotion(direction: SwapDirection): CoverMotion {
  const turn = direction === 'next' ? '-20deg' : direction === 'previous' ? '20deg' : '0deg';
  return {
    incoming: [
      [
        [
          { scale: '0.85', rotate: turn },
          { scale: '1', rotate: '0deg' },
        ],
        settle,
      ],
      [
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: DURATION_MS.faster, easing: CURVE.linear.timing },
      ],
    ],
    outgoing: [
      [
        [
          { scale: '1', opacity: 1 },
          { scale: '0.85', opacity: 0 },
        ],
        { duration: DURATION_MS.faster, easing: CURVE.accelerateMid.timing },
      ],
    ],
  };
}

/** 各形态的封面过渡；`still` 答 null，直接换。 */
export function coverMotion(shape: CoverShape, turn: CoverTurn): CoverMotion | null {
  if (turn === 'still') return null;
  if (turn === 'fade') return coverFade;
  if (shape === 'bar') return pushMotion(turn);
  if (shape === 'lcd') return wipeMotion(turn);
  return spinMotion(turn);
}
